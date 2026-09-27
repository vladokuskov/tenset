import { attachHand, handFrame, implementFromHand, legKinematics, midpoint, root1d, writeLeg, type FootTarget } from '../constraints.ts'
import { centerOfMass, fk, localToWorld, sitePos } from '../fk.ts'
import { barbell, dumbbell, siteWorld, type ImplementSpec, type Part } from '../implements.ts'
import { add, cross, DEG, lerp, neg, norm, qaxis, qconj, qfromBasis, qid, qmul, qrot, scale, sub, type Quat, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import type { ParamsOf } from './schemas.ts'
import { SCHEMAS } from './schemas.ts'
import { hipsFor, makeStance, plantedContacts, setPelvis, stanceWidth, stand, standBalanced, type StanceSetup } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Squat family. Standing variants key knee flexion and ankle dorsiflexion by depth; the hips follow from the planted
// feet (knees bend in the plane of the toes) and the trunk lean is solved each frame so the bar stays over the
// midfoot (free bar), over the rail line (Smith) or, without a bar, the ankles bring the system COM over the midfoot.
// High-bar vs low-bar vs front-rack lean falls out of where the bar sits. The leg press fixes the pelvis to the seat
// and moves the sled along its rail; the legs are solved to the feet on the plate.

type P = ParamsOf<'squat'>

// knee flexion / ankle dorsiflexion at the bottom, deg (Escamilla 2001; Endo 2020; author judgment per hold)
const KNEE: Record<P['depth'], number> = { quarter: 60, parallel: 100, full: 118 }
const ANKLE: Record<string, Record<P['depth'], number>> = {
  back_high: { quarter: 12, parallel: 21, full: 26 },
  back_low: { quarter: 10, parallel: 19, full: 24 },
  front_rack: { quarter: 14, parallel: 24, full: 30 },
  goblet: { quarter: 13, parallel: 23, full: 28 },
  none: { quarter: 12, parallel: 21, full: 25 },
  // feet forward of the rail: shins stay closer to vertical
  smith: { quarter: 5, parallel: 8, full: 12 },
}
const TOP_KNEE = 3
const TOP_ANKLE = 5
/** trunk (pelvis) lean at the bottom when no bar sets it, deg */
const TILT: Record<string, number> = { goblet: 32, none: 42 }
const DB_KG = 24
/** Smith: midfoot ahead of the rail line, m */
const SMITH_FEET: Record<P['footPosition'], number> = { low: 0, mid: 0.06, high: 0.12, forward: 0.16 }
/** front rack grip: the schema default (2.1) is a back-squat width; clean grips sit just outside the shoulders */
const RACK_GRIP = 1.3

// leg press: knee flexion at the bottom and the dorsiflexion footPosition sets there (author judgment)
const PRESS_KNEE: Record<P['depth'], number> = { quarter: 50, parallel: 75, full: 92 }
const PRESS_TOP_KNEE = 10
const PRESS_DF: Record<P['footPosition'], number> = { low: 37, mid: 33, high: 24, forward: 24 }
/** stop the sled before hip flexion runs out (posterior pelvic tilt is not modelled) */
const PRESS_HIP_MAX = 128
/** back pad recline from vertical, deg */
const PRESS_RECLINE = 50
const PRESS_HIP: V3 = [0, 0.62, 0]

type Stand = {
  kind: 'stand'
  stance: StanceSetup
  holdKey: string
  bar?: ImplementSpec
  barSite?: 'back_high' | 'back_low' | 'front_rack'
  /** Smith rail line (z); the bar stays on it */
  railZ?: number
  goblet?: boolean
}

type Press = {
  kind: 'press'
  d: V3
  up: V3
  sledRot: Quat
  feet: { side: 'l' | 'r'; rot: Quat; local: V3 }[]
  s: [number, number]
  handles: ImplementSpec
}

type Ctx = { tempo: Tempo; setup: Setup; v: Stand | Press }

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

function unsupported(p: P) {
  if (p.implement === 'machine') return p.machine === 'leg_press' ? null : `machine ${p.machine}`
  if (p.posture !== 'standing') return `${p.implement}/${p.posture}`
  if ((p.implement === 'barbell' || p.implement === 'smith') && !['back_high', 'back_low', 'front_rack'].includes(p.hold)) return `${p.implement} hold ${p.hold}`
  if (p.implement === 'smith' && p.hold === 'front_rack') return 'smith front rack'
  if (p.implement === 'dumbbell' && p.hold !== 'goblet') return `dumbbell hold ${p.hold}`
  return null
}

function gripContacts(id: string): Contact[] {
  return [
    { site: 'grip_l', kind: 'grip', target: { implement: id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: id, grip: 'r' } },
  ]
}

function standContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const smith = p.implement === 'smith'
  const railZ = smith ? 0 : undefined
  const stance = makeStance(skel, stanceWidth(skel, p.stance), p.toeOut, smith ? SMITH_FEET[p.footPosition] : 0)
  const contacts: Contact[] = plantedContacts(skel, stance)
  const impls: ImplementSpec[] = []
  const v: Stand = { kind: 'stand', stance, holdKey: 'none' }
  if (p.implement === 'barbell' || smith) {
    const rack = p.hold === 'front_rack'
    const bar = barbell({ gripWidth: (rack ? Math.min(p.gripWidth, RACK_GRIP) : p.gripWidth) * skel.data.shoulderWidth, plateKg: smith ? 20 : 40 })
    impls.push(bar)
    v.bar = bar
    v.barSite = p.hold as Stand['barSite']
    v.holdKey = smith ? 'smith' : p.hold
    // front rack: the bar rides on the delts and the fingers only steady it, so there is no grip constraint
    if (!rack) contacts.push(...gripContacts(bar.id))
    if (smith) {
      v.railZ = railZ
      impls.push({
        id: 'smith',
        kind: 'bench',
        mass: 0,
        com: [0, 0, 0],
        parts: [cyl([0.6, 0, railZ!], [0.6, 2.25, railZ!], 0.025), cyl([-0.6, 0, railZ!], [-0.6, 2.25, railZ!], 0.025), cyl([-0.6, 2.25, railZ!], [0.6, 2.25, railZ!], 0.03)],
        sites: {},
      })
    }
  } else if (p.implement === 'dumbbell') {
    impls.push(dumbbell({ id: 'db', mass: DB_KG }))
    v.holdKey = 'goblet'
    v.goblet = true
  }
  const setup: Setup = {
    implements: impls,
    contacts,
    tempo,
    symmetric: true,
    // the Smith rails carry any horizontal load, so the feet do not have to sit under the bar
    balance: smith ? undefined : v.bar ? { point: { implement: v.bar.id }, over: 'midfoot', tol: 0.025 } : { point: 'com', over: 'midfoot', tol: 0.025 },
  }
  return { tempo, setup, v }
}

function trunk(skel: Skeleton, q: Float64Array, s: number) {
  setDofs(skel, q, { 'lumbar.flex': 8 * s, 'thorax.flex': 4 * s, 'clavicle_*.prot': -12, 'clavicle_*.elev': 4, 'grip_*.close': 1 })
}

function gaze(skel: Skeleton, q: Float64Array) {
  const d = skel.dof
  const pitch = q[d['pelvis.tilt']] + q[d['lumbar.flex']] + q[d['thorax.flex']]
  setDofs(skel, q, { 'neck.flex': -0.4 * pitch, 'head.flex': -0.2 * pitch })
}

function barArms(skel: Skeleton, q: Float64Array, v: Stand, bar: ImplementPose) {
  for (const side of ['l', 'r'] as const) {
    const g = siteWorld(v.bar!, bar, side)
    const lat = side === 'l' ? 1 : -1
    if (v.barSite === 'front_rack') {
      // elbows high and forward, fingers under the bar; wrist extension runs into its limit, which is expected
      setDofs(skel, q, { [`clavicle_${side}.prot`]: 10, [`clavicle_${side}.elev`]: 8, [`grip_${side}.close`]: 0.35 })
      attachHand(skel, q, side, { pos: g.pos, axis: g.axis!, palm: [0, 1, -0.4] }, { pole: [lat * 0.35, -0.25, 1], wristBias: 70, planeHint: 80 })
      continue
    }
    // high bar: elbows down and out; low bar: elbows back and up
    const pole: V3 = v.barSite === 'back_low' ? [lat * 0.6, -0.3, -1] : [lat, -0.5, -0.5]
    attachHand(skel, q, side, { pos: g.pos, axis: g.axis!, palm: [0, 0.3, 1] }, { pole, wristBias: v.barSite === 'back_low' ? 20 : 10 })
  }
}

function bodyweightArms(skel: Skeleton, q: Float64Array, p: P, s: number) {
  if (p.armPosition === 'forward') setDofs(skel, q, { 'shoulder_*.plane': 90, 'shoulder_*.elev': 60 + 30 * s, 'elbow_*.flex': 5, 'grip_*.close': 0.2 })
  else if (p.armPosition === 'crossed') setDofs(skel, q, { 'shoulder_*.plane': 110, 'shoulder_*.elev': 80, 'elbow_*.flex': 140, 'shoulder_*.rot': 60 })
  else setDofs(skel, q, { 'shoulder_*.plane': 0, 'shoulder_*.elev': 25, 'shoulder_*.rot': 60, 'elbow_*.flex': 100 })
}

function gobletArms(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, {
    'shoulder_*.plane': 80, 'shoulder_*.elev': 30, 'shoulder_*.rot': 25, 'elbow_*.flex': 140, 'forearm_*.pro': -40,
    'wrist_*.flex': -10, 'clavicle_*.prot': 6, 'clavicle_*.elev': 2,
  })
}

function sampleStand(u: number, p: P, skel: Skeleton, ctx: Ctx, v: Stand): Pose {
  const s = 1 - phaseAt(u, ctx.tempo).c
  // knees and ankles trail the hips slightly
  const sk = 1 - phaseAt(u, ctx.tempo, 0.012).c
  const knee = lerp(TOP_KNEE, KNEE[p.depth], sk)
  const df = lerp(TOP_ANKLE, ANKLE[v.holdKey][p.depth], sk)
  const q = zeroQ(skel)
  trunk(skel, q, s)
  if (v.bar) {
    // bar over the midfoot (or the Smith rail): 1-D root find on pelvis tilt with the hips set by knee and ankle
    const hipMid = hipsFor(skel, v.stance, knee, df)
    const target = v.railZ ?? v.stance.midfoot[2]
    const r = root1d((tilt) => {
      setPelvis(skel, q, hipMid, tilt)
      return sitePos(skel, fk(skel, q), v.barSite!)[2] - target
    }, -15, 80, { tol: 1e-7 })
    stand(skel, q, v.stance, { knee, df, tilt: r.x })
  } else {
    // no bar: trunk lean keyed, ankles bring the system COM over the midfoot
    const upper = v.goblet ? (qq: Float64Array) => gobletArms(skel, qq) : (qq: Float64Array) => bodyweightArms(skel, qq, p, s)
    const measure = (qq: Float64Array) => {
      const f = fk(skel, qq)
      const loads = v.goblet ? [{ mass: DB_KG, pos: midpoint(handFrame(skel, f, 'l').pos, handFrame(skel, f, 'r').pos) }] : []
      return centerOfMass(skel, f, loads)[2]
    }
    standBalanced(skel, q, v.stance, { knee, tilt: 3 + TILT[v.holdKey] * s }, measure, upper, [-10, 40])
  }
  gaze(skel, q)
  const implements_: ImplementPose[] = []
  if (v.bar) {
    const bp: ImplementPose = { id: v.bar.id, pos: sitePos(skel, fk(skel, q), v.barSite!), rot: qid() }
    if (v.railZ !== undefined) bp.pos[2] = v.railZ
    barArms(skel, q, v, bp)
    implements_.push(bp)
    if (v.railZ !== undefined) implements_.push({ id: 'smith', pos: [0, 0, 0], rot: qid() })
  } else if (v.goblet) {
    const f = fk(skel, q)
    implements_.push({ id: 'db', pos: midpoint(handFrame(skel, f, 'l').pos, handFrame(skel, f, 'r').pos), rot: implementFromHand([0, 1, 0], [0, 0, 1]) })
  }
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

// ---------- leg press ----------

function pressPelvis(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'lumbar.flex': 4, 'thorax.flex': 6, 'neck.flex': 22, 'head.flex': 10, 'clavicle_*.prot': -5, 'grip_*.close': 1 })
  setPelvis(skel, q, PRESS_HIP, -(PRESS_RECLINE + 10))
}

function pressFeet(skel: Skeleton, v: Pick<Press, 'd' | 'sledRot' | 'feet'>, s: number): FootTarget[] {
  const origin = add(PRESS_HIP, scale(v.d, s))
  return v.feet.map((f) => {
    const spot = add(origin, qrot(v.sledRot, f.local))
    return { side: f.side, rot: f.rot, ankle: sub(spot, qrot(f.rot, skel.data.sites[`midfoot_${f.side}`].local)) }
  })
}

function pressLegs(skel: Skeleton, q: Float64Array, feet: FootTarget[]) {
  const f = fk(skel, q)
  const pr = f.rot[skel.seg.pelvis]
  return feet.map((foot) => {
    const leg = legKinematics(skel, foot.side, f.pos[skel.seg[`femur_${foot.side}`]], pr, foot)
    writeLeg(skel, q, foot.side, leg)
    return leg
  })
}

function pressContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const a = p.sledAngle * DEG
  const d: V3 = [0, Math.sin(a), Math.cos(a)]
  const up: V3 = [0, Math.cos(a), -Math.sin(a)]
  // sled frame: X across, Y = plate normal towards the lifter, Z up the plate
  const sledRot = qfromBasis([1, 0, 0], neg(d))
  const half = stanceWidth(skel, p.stance) / 2
  const q = zeroQ(skel)
  pressPelvis(skel, q)
  const placed = (e: number) => ({
    d,
    sledRot,
    feet: (['l', 'r'] as const).map((side) => ({
      side,
      rot: qmul(qaxis(neg(d), (side === 'l' ? p.toeOut : -p.toeOut) * DEG), sledRot),
      local: [side === 'l' ? half : -half, 0, e] as V3,
    })),
  })
  const legAt = (e: number, s: number) => pressLegs(skel, q, pressFeet(skel, placed(e), s))[0]
  const sFor = (e: number, knee: number) => root1d((s) => legAt(e, s).knee - knee, 0.2, 1.1, { tol: 1e-7 }).x
  // foot height on the plate: dorsiflexion at the bottom hits the footPosition target
  const eFor = (knee: number) => root1d((e) => legAt(e, sFor(e, knee)).ankle[0] - PRESS_DF[p.footPosition], -0.3, 0.4, { tol: 1e-6 }).x
  let bottom = PRESS_KNEE[p.depth]
  let e = eFor(bottom)
  for (let k = 0; k < 20 && legAt(e, sFor(e, bottom)).hip[0] > PRESS_HIP_MAX; k++) e = eFor((bottom -= 2))
  const s: [number, number] = [sFor(e, bottom), sFor(e, PRESS_TOP_KNEE)]
  const v0 = placed(e)
  const f0 = fk(skel, q)
  const pr = f0.rot[skel.seg.pelvis]
  const W = (local: V3) => localToWorld(skel, f0, 'pelvis', local)
  const fwd = qrot(pr, [0, 0, 1])
  const handles: ImplementSpec = {
    id: 'handles',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [cyl(W([0.3, 0.02, 0.02]), W([0.3, 0.02, 0.2]), 0.016), cyl(W([-0.3, 0.02, 0.02]), W([-0.3, 0.02, 0.2]), 0.016)],
    sites: { l: { pos: W([0.3, 0.02, 0.12]), axis: fwd }, r: { pos: W([-0.3, 0.02, 0.12]), axis: fwd } },
  }
  // seat pan under the pelvis and back pad behind the trunk (static, drawn only)
  const back = norm(sub(f0.pos[skel.seg.neck1], f0.pos[skel.seg.pelvis]))
  const behind = norm(cross([1, 0, 0], back))
  const padRot = qfromBasis([1, 0, 0], neg(behind))
  const padMid = add(scale(add(f0.pos[skel.seg.pelvis], f0.pos[skel.seg.neck1]), 0.5), scale(behind, 0.14))
  const seatRot = qmul(qaxis([1, 0, 0], -25 * DEG), qfromBasis([1, 0, 0], [0, 1, 0]))
  const seatMid = add(W([0, -0.12, 0.12]), [0, -0.03, 0])
  const railFrom = add(PRESS_HIP, add(scale(d, s[0] + 0.1), scale(up, -0.25)))
  const railTo = add(PRESS_HIP, add(scale(d, s[1] + 0.5), scale(up, -0.25)))
  const frame: ImplementSpec = {
    id: 'press',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      { shape: 'box', center: padMid, size: [0.4, 0.06, 0.75], rot: padRot },
      { shape: 'box', center: seatMid, size: [0.42, 0.06, 0.42], rot: seatRot },
      cyl(add(railFrom, [0.3, 0, 0]), add(railTo, [0.3, 0, 0]), 0.03),
      cyl(add(railFrom, [-0.3, 0, 0]), add(railTo, [-0.3, 0, 0]), 0.03),
      cyl(add(seatMid, [0, -0.05, 0]), [0, 0, seatMid[2]], 0.04),
    ],
    sites: {},
  }
  const sledSites: Record<string, { pos: V3 }> = {}
  const feet = pressFeet(skel, v0, 0)
  for (const f of feet) for (const site of ['heel', 'ball']) {
    const name = `${site}_${f.side}`
    sledSites[name] = { pos: qrot(qconj(sledRot), sub(add(f.ankle, qrot(f.rot, skel.data.sites[name].local)), PRESS_HIP)) }
  }
  const sled: ImplementSpec = {
    id: 'sled',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [{ shape: 'box', center: [0, -0.02, 0.05], size: [0.75, 0.04, 0.7] }, cyl([0.3, -0.04, -0.25], [0.3, -0.25, -0.25], 0.03), cyl([-0.3, -0.04, -0.25], [-0.3, -0.25, -0.25], 0.03)],
    sites: sledSites,
  }
  // feet ride on the sled, so they are checked like grips (distance to the moving plate), not as floor contacts
  const contacts: Contact[] = [
    ...feet.flatMap((f) => ['heel', 'ball'].map((site) => ({ site: `${site}_${f.side}`, kind: 'grip' as const, target: { implement: 'sled', grip: `${site}_${f.side}` } }))),
    ...gripContacts('handles'),
  ]
  const setup: Setup = { implements: [sled, frame, handles], contacts, tempo, symmetric: true }
  return { tempo, setup, v: { kind: 'press', d, up, sledRot, feet: v0.feet, s, handles } }
}

function samplePress(u: number, skel: Skeleton, ctx: Ctx, v: Press): Pose {
  const c = phaseAt(u, ctx.tempo).c
  const sled = lerp(v.s[0], v.s[1], c)
  const q = zeroQ(skel)
  pressPelvis(skel, q)
  pressLegs(skel, q, pressFeet(skel, v, sled))
  const hp: ImplementPose = { id: 'handles', pos: [0, 0, 0], rot: qid() }
  for (const side of ['l', 'r'] as const) {
    const g = siteWorld(v.handles, hp, side)
    attachHand(skel, q, side, { pos: g.pos, axis: g.axis!, palm: [side === 'l' ? -1 : 1, 0, 0] }, { pole: [side === 'l' ? 1 : -1, 0.2, -0.6], planeHint: 0 })
  }
  return {
    q,
    implements: [{ id: 'sled', pos: add(PRESS_HIP, scale(v.d, sled)), rot: v.sledRot }, { id: 'press', pos: [0, 0, 0], rot: qid() }, hp],
    contacts: ctx.setup.contacts,
  }
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const why = unsupported(p)
  if (why) throw new Error(`squat: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  return p.implement === 'machine' ? pressContext(p, skel, tempo) : standContext(p, skel, tempo)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  return ctx.v.kind === 'press' ? samplePress(u, skel, ctx, ctx.v) : sampleStand(u, p, skel, ctx, ctx.v)
}

export const squat: Template<P> = {
  id: 'squat',
  driver: 'implement',
  params: SCHEMAS.squat,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}


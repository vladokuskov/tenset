import { attachHand, handFrame, implementFromHand, legKinematics, root1d, writeLeg, type FootTarget } from '../constraints.ts'
import { dls } from '../ik.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts, restAgainst } from '../collide.ts'
import { centerOfMass, fk, localToWorld } from '../fk.ts'
import { barbell, dumbbell, siteWorld, type ImplementSpec, type Part } from '../implements.ts'
import { add, cross, DEG, dot, lerp, neg, norm, qaxis, qconj, qfromBasis, qid, qmul, qrot, scale, sub, type Quat, type V3 } from '../math.ts'
import { setDofs, setScapula, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
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
  back_high: { quarter: 12, parallel: 23, full: 33 },
  back_low: { quarter: 10, parallel: 19, full: 24 },
  front_rack: { quarter: 14, parallel: 24, full: 30 },
  goblet: { quarter: 13, parallel: 23, full: 28 },
  none: { quarter: 12, parallel: 21, full: 25 },
  // feet forward of the rail: shins a bit more vertical than a free squat, not fully, since with the bar fixed on
  // the rail every degree of shin angle given up turns into forward trunk lean
  smith: { quarter: 9, parallel: 17, full: 22 },
}
const TOP_KNEE = 3
const TOP_ANKLE = 5
/** trunk (pelvis) lean at the bottom when no bar sets it, deg */
const TILT: Record<string, number> = { goblet: 20, none: 22 }
const DB_KG = 24
/**
 * Goblet: the dumbbell stands vertical against the chest, its centre `up` above the sternum and sunk `sink` into it;
 * both palms cup the underside of the top head either side of the handle (dumbbell frame: X up the handle, Y forward,
 * Z to the lifter's left), palms up and in, fingers up round the rim, elbows down.
 */
const GOBLET = { up: 0.05, sink: 0.004, cup: [0.033, 0.03, 0.06] as V3, fingers: [1, 0.8, -0.3] as V3, palm: [1, 0, -0.5] as V3 }
const GOBLET_ROT = implementFromHand([0, 1, 0], [0, 0, 1])
/** Smith: midfoot ahead of the rail line, m */
const SMITH_FEET: Record<P['footPosition'], number> = { low: 0, mid: 0.06, high: 0.12, forward: 0.16 }
/** front rack grip: the schema default (2.1) is a back-squat width; clean grips sit just outside the shoulders */
const RACK_GRIP = 1.3
/** front rack wrist extension range (motion decision 2026-09-27: real lifters pass the 70 deg default) */
const RACK_WRIST: [number, number] = [-90, 75]
/**
 * Front rack: elbows up and forward (upper arm near horizontal), the bar on the shelf the raised front delts make,
 * clear of the throat, and across the fingers with the wrists extended. The bar goes where the fingers hold it; the
 * arm is solved for the shelf, the throat, the elbow height and the grip width together.
 */
const RACK = {
  /** upper-arm elevation the solve pulls towards, deg */
  elev: 82,
  /** bar sinking into the delts (capsule clearance, m) */
  sink: 0.008,
  /** clearance from the bar to the neck and head, m */
  throat: 0.02,
  /** scapulae protracted and elevated: the shoulders come forward and up under the bar */
  clavicle: { prot: 14, elev: 10 },
}
/** plane, elevation, rotation, elbow, pronation, wrist flexion, deviation */
const RACK_SEEDS = [[75, 80, -20, 145, 40, -80, 0], [85, 85, 0, 148, 60, -85, 5], [70, 75, -40, 140, 20, -75, -5]]
/** body regions a bar rests on, where it may sink into the soft tissue a little */
const BAR_REST: Record<NonNullable<Stand['barSite']>, string[]> = {
  back_high: ['trunk', 'girdle_l', 'girdle_r', 'neck', 'upperarm_l', 'upperarm_r'],
  back_low: ['trunk', 'girdle_l', 'girdle_r', 'upperarm_l', 'upperarm_r'],
  front_rack: ['trunk', 'girdle_l', 'girdle_r', 'upperarm_l', 'upperarm_r'],
}
/** unloaded squat: centre of mass target behind the midfoot, m (towards the heel, trunk more upright) */
const UNLOADED_COM = -0.03

// leg press: knee flexion at the bottom and the dorsiflexion footPosition sets there (author judgment)
const PRESS_KNEE: Record<P['depth'], number> = { quarter: 50, parallel: 75, full: 92 }
const PRESS_TOP_KNEE = 10
const PRESS_DF: Record<P['footPosition'], number> = { low: 37, mid: 33, high: 24, forward: 24 }
/** stop the sled before the thighs reach the ribs (posterior pelvic tilt is not modelled; the gate caught 128) */
const PRESS_HIP_MAX = 112
/** back pad recline from vertical, deg */
const PRESS_RECLINE = 53
const PRESS_HIP: V3 = [0, 0.62, 0]
/** the drawn leg press's seat pan (props/legpress.ts): surface centre `along` the pan from the hip point and `drop` below it */
const PRESS_SEAT = { along: 0.114, drop: 0.0545, tilt: 25 }

type Stand = {
  kind: 'stand'
  stance: StanceSetup
  holdKey: string
  bar?: ImplementSpec
  barSite?: 'back_high' | 'back_low' | 'front_rack'
  /** bar centre in the thorax2 frame: the site, lifted onto the delts for a front rack */
  barLocal?: V3
  /** Smith rail line (z); the bar stays on it */
  railZ?: number
  /** ankle dorsiflexion at the top; with a bar, whatever puts it over its line with the trunk upright */
  topDf: number
  /** arm DOFs for a bar fixed on the torso: solved once, constant through the rep */
  arms?: [number, number][]
  goblet?: boolean
}

type Press = {
  kind: 'press'
  d: V3
  sledRot: Quat
  feet: { side: 'l' | 'r'; rot: Quat; local: V3 }[]
  s: [number, number]
  /** body offset from the hip point (seated on the drawn seat pan) */
  shift: V3
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

function rackContacts(id: string): Contact[] {
  return [
    { site: 'fingers_l', kind: 'grip', target: { implement: id, grip: 'l' } },
    { site: 'fingers_r', kind: 'grip', target: { implement: id, grip: 'r' } },
  ]
}

function standContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const smith = p.implement === 'smith'
  const railZ = smith ? 0 : undefined
  const stance = makeStance(skel, stanceWidth(skel, p.stance), p.toeOut, smith ? SMITH_FEET[p.footPosition] : 0)
  const contacts: Contact[] = plantedContacts(skel, stance)
  const impls: ImplementSpec[] = []
  const v: Stand = { kind: 'stand', stance, holdKey: 'none', topDf: TOP_ANKLE }
  if (p.implement === 'barbell' || smith) {
    const rack = p.hold === 'front_rack'
    const bar = barbell({ gripWidth: (rack ? Math.min(p.gripWidth, RACK_GRIP) : p.gripWidth) * skel.data.shoulderWidth, plateKg: smith ? 20 : 40 })
    impls.push(bar)
    v.bar = bar
    const site = p.hold as NonNullable<Stand['barSite']>
    v.barSite = site
    v.barLocal = skel.data.sites[site].local
    v.holdKey = smith ? 'smith' : p.hold
    // front rack: the bar rides on the delts and lies across the fingers (a clean grip), wrists extended
    contacts.push(...(rack ? rackContacts(bar.id) : gripContacts(bar.id)))
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
    const db = dumbbell({ id: 'db', mass: DB_KG })
    const [x, y, z] = GOBLET.cup
    const [ax, ay, az] = gobletHand().axis
    db.sites.cup_l = { pos: [x, y, z], axis: [ax, ay, az] }
    db.sites.cup_r = { pos: [x, y, -z], axis: [ax, ay, -az] }
    impls.push(db)
    contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: 'db', grip: 'cup_l' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'db', grip: 'cup_r' } })
    v.holdKey = 'goblet'
    v.goblet = true
  }
  if (v.bar) {
    v.arms = solveBarArms(skel, v)
    // lockout: trunk upright, the whole body leans at the ankles until the bar sits over its line
    const q = zeroQ(skel)
    for (const [i, x] of v.arms) q[i] = x
    const target = railZ ?? stance.midfoot[2]
    v.topDf = root1d((df) => {
      setPelvis(skel, q, hipsFor(skel, stance, TOP_KNEE, df), 3)
      return barPos(skel, q, v)[2] - target
    }, -25, 25, { tol: 1e-7 }).x
  }
  const setup: Setup = {
    implements: impls,
    contacts,
    tempo,
    symmetric: true,
    // the Smith rails carry any horizontal load, so the feet do not have to sit under the bar. Without load the
    // centre of mass may sit towards the heel, which keeps the trunk more upright
    balance: smith ? undefined : v.bar ? { point: { implement: v.bar.id }, over: 'midfoot', tol: 0.025 } : { point: 'com', over: 'midfoot', tol: 0.025, target: v.goblet ? 0 : UNLOADED_COM },
  }
  if (v.bar) setup.rests = [{ implement: v.bar.id, regions: BAR_REST[v.barSite!], tol: 20 }]
  // the dumbbell rests on the chest and the cupped palms press on the top head
  if (v.goblet) setup.rests = [{ implement: 'db', regions: ['trunk', 'hand_l', 'hand_r'], tol: 15 }]
  if (v.barSite === 'front_rack') setup.limits = { 'wrist_l.flex': RACK_WRIST, 'wrist_r.flex': RACK_WRIST }
  return { tempo, setup, v }
}

function trunk(skel: Skeleton, q: Float64Array, s: number) {
  setDofs(skel, q, { 'lumbar.flex': 8 * s, 'thorax.flex': 4 * s })
}

function gaze(skel: Skeleton, q: Float64Array) {
  const d = skel.dof
  const pitch = q[d['pelvis.tilt']] + q[d['lumbar.flex']] + q[d['thorax.flex']]
  setDofs(skel, q, { 'neck.flex': -0.4 * pitch, 'head.flex': -0.2 * pitch })
}

const ARM_DOFS = ['clavicle_*.prot', 'clavicle_*.elev', 'scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev', 'grip_*.close']

function barPos(skel: Skeleton, q: Float64Array, v: Stand): V3 {
  return localToWorld(skel, fk(skel, q), 'thorax2', v.barLocal!)
}

/**
 * Arms on a bar that rides on the torso, solved once in a standing pose (elbow and palm directions in the thorax
 * frame). The left arm is solved and mirrored, so the hold is exactly symmetric.
 */
function solveBarArms(skel: Skeleton, v: Stand): [number, number][] {
  const q = zeroQ(skel)
  trunk(skel, q, 0)
  setDofs(skel, q, { 'clavicle_*.prot': -12, 'clavicle_*.elev': 4, 'grip_*.close': 1 })
  stand(skel, q, v.stance, { knee: TOP_KNEE, df: TOP_ANKLE, tilt: 3 })
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  const T = (x: number, y: number, z: number) => qrot(thorax, [x, y, z])
  if (v.barSite === 'front_rack') solveRack(skel, q, v)
  else {
    const g = siteWorld(v.bar!, { id: v.bar!.id, pos: barPos(skel, q, v), rot: qid() }, 'l')
    // high bar: elbows down and back; low bar: elbows back and up
    const pole = v.barSite === 'back_low' ? T(0.5, -0.3, -1) : T(0.4, -0.7, -0.6)
    attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: T(0, 0.3, 1) }, { pole, wristBias: v.barSite === 'back_low' ? 20 : 10, planeHint: -90 })
  }
  return ARM_DOFS.flatMap((k) => {
    const x = q[skel.dof[k.replace('*', 'l')]]
    return [[skel.dof[k.replace('*', 'l')], x], [skel.dof[k.replace('*', 'r')], x]] as [number, number][]
  })
}

/** front rack arm (left; mirrored by the caller) and the bar position in the thorax frame it puts the bar at */
function solveRack(skel: Skeleton, q: Float64Array, v: Stand) {
  setDofs(skel, q, { 'clavicle_l.prot': RACK.clavicle.prot, 'clavicle_l.elev': RACK.clavicle.elev, 'grip_l.close': 0.6 })
  const names = ['shoulder_l.plane', 'shoulder_l.elev', 'shoulder_l.rot', 'elbow_l.flex', 'forearm_l.pro', 'wrist_l.flex', 'wrist_l.dev'].map((n) => skel.dof[n])
  const lo = [30, 45, -100, 115, -90, RACK_WRIST[0], -35], hi = [125, 105, 70, 150, 85, RACK_WRIST[1], 20]
  const site = skel.data.sites.fingers_l
  const g = v.bar!.sites.l.pos[0]
  const r = (v.bar!.parts[0] as Extract<Part, { shape: 'cylinder' }>).r
  const measure = (x: number[]) => {
    names.forEach((d, i) => (q[d] = x[i]))
    setScapula(skel, q, 'l')
    const f = fk(skel, q)
    const t = skel.seg.thorax2
    const tip = qrot(qconj(f.rot[t]), sub(localToWorld(skel, f, 'hand_l', site.local), f.pos[t]))
    const bar = { a: localToWorld(skel, f, 'thorax2', [-0.35, tip[1], tip[2]]), b: localToWorld(skel, f, 'thorax2', [0.35, tip[1], tip[2]]), r }
    const caps = bodyCapsules(skel, f)
    const clear = (regions: string[]) => Math.min(...caps.filter((c) => regions.includes(c.region)).map((c) => capsuleClearance(c, bar)))
    const arm = caps.filter((c) => c.region === 'upperarm_l'), chest = caps.filter((c) => c.region === 'trunk')
    const press = Math.max(0, ...arm.flatMap((a) => chest.map((c) => -capsuleClearance(a, c) - 0.006)))
    const head = caps.filter((c) => c.region === 'neck' || c.region === 'head')
    const hand = caps.filter((c) => c.region === 'hand_l' || c.region === 'forearm_l')
    const handHead = Math.min(...hand.flatMap((a) => head.map((c) => capsuleClearance(a, c))))
    const across = qrot(f.rot[skel.seg.hand_l], site.axis!)
    const slant = Math.acos(Math.min(1, Math.abs(dot(across, qrot(f.rot[t], [1, 0, 0]))))) / DEG
    const palmUp = dot(qrot(f.rot[skel.seg.hand_l], site.normal!), qrot(f.rot[t], [0, 1, 0]))
    return { tip, shelf: clear(['upperarm_l', 'girdle_l']), throat: clear(['neck', 'head']), chest: clear(['trunk']), press, handHead, slant, palmUp }
  }
  const res = (x: number[]) => {
    const m = measure(x)
    return [
      (m.tip[0] - g) * 300,
      (m.shelf + RACK.sink) * 100,
      Math.max(0, RACK.throat - m.throat) * 200,
      Math.max(0, -m.chest - 0.012) * 100,
      (x[1] - RACK.elev) * 0.1,
      (x[5] + 80) * 0.01,
      Math.max(0, m.slant - 35) * 0.05,
      Math.max(0, 0.4 - m.palmUp) * 5,
      m.press * 100,
      Math.max(0, 0.005 - m.handHead) * 100,
    ]
  }
  let best: { x: number[]; err: number } | null = null
  for (const seed of RACK_SEEDS) {
    const r0 = dls(res, seed, { iters: 120, lo, hi })
    if (!best || r0.err < best.err) best = r0
  }
  const m = measure(best!.x)
  v.barLocal = [0, m.tip[1], m.tip[2]]
}

function bodyweightArms(skel: Skeleton, q: Float64Array, p: P, s: number) {
  if (p.armPosition === 'forward') setDofs(skel, q, { 'shoulder_*.plane': 90, 'shoulder_*.elev': 60 + 30 * s, 'elbow_*.flex': 5, 'forearm_*.pro': 40, 'grip_*.close': 0.2 })
  else if (p.armPosition === 'crossed') setDofs(skel, q, { 'shoulder_*.plane': 110, 'shoulder_*.elev': 80, 'elbow_*.flex': 140, 'shoulder_*.rot': 60 })
  else setDofs(skel, q, { 'shoulder_*.plane': 0, 'shoulder_*.elev': 25, 'shoulder_*.rot': 60, 'elbow_*.flex': 100 })
  scapulae(skel, q)
}

/** left cupped hand in the dumbbell frame: palm up and in, fingers up and forward; pinky-to-index line and palm */
function gobletHand(): { axis: V3; palm: V3 } {
  const f = norm(GOBLET.fingers)
  const p0 = norm(GOBLET.palm)
  const palm = norm(sub(p0, scale(f, dot(p0, f))))
  return { axis: cross(palm, f), palm }
}

let gobletLast: { skel: Skeleton; key: string; pose: ImplementPose } | null = null

/** goblet dumbbell: vertical, resting against the chest in front of the sternum */
function gobletPose(skel: Skeleton, f: ReturnType<typeof fk>, spec: ImplementSpec): ImplementPose {
  const t = skel.seg.thorax2
  const key = `${f.pos[t].join()}|${f.rot[t].join()}`
  if (gobletLast?.skel === skel && gobletLast.key === key) return gobletLast.pose
  const base = add(localToWorld(skel, f, 'thorax2', skel.data.sites.sternum.local), [0, GOBLET.up, 0])
  const fwd = qrot(f.rot[t], [0, 0, 1])
  const dir = norm([fwd[0], 0, fwd[2]])
  const chest = bodyCapsules(skel, f).filter((c) => c.region === 'trunk' && c.segment.startsWith('thorax'))
  const at = (d: number): ImplementPose => ({ id: 'db', pos: add(base, scale(dir, d)), rot: GOBLET_ROT })
  // the heads meet the chest before the handle does; clearance grows almost linearly with the distance, so secant steps
  const heads = { ...spec, parts: spec.parts.slice(1) }
  const gap = (d: number) => Math.min(...placeParts(heads, at(d)).flatMap((sd) => chest.map((c) => capsuleSolidClearance(c, sd)))) + GOBLET.sink
  let d0 = 0.1, d1 = 0.2, g0 = gap(d0), g1 = gap(d1)
  for (let k = 0; k < 12 && Math.abs(g1) > 1e-6 && g1 !== g0; k++) {
    const d2 = Math.min(0.4, Math.max(0, d1 - (g1 * (d1 - d0)) / (g1 - g0)))
    ;[d0, g0, d1, g1] = [d1, g1, d2, gap(d2)]
  }
  const pose = at(d1)
  gobletLast = { skel, key, pose }
  return pose
}

/** both palms onto the top head (left solved, right mirrored) */
function gobletArms(skel: Skeleton, q: Float64Array, spec: ImplementSpec) {
  setDofs(skel, q, { 'clavicle_*.prot': 6, 'clavicle_*.elev': 2, 'grip_*.close': 1 })
  const pose = gobletPose(skel, fk(skel, q), spec)
  const g = siteWorld(spec, pose, 'cup_l')
  const palm = qrot(pose.rot, gobletHand().palm)
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm }, { pole: [-0.1, -1, 0.5], planeHint: 60, wristBias: 40 })
  for (const k of ARM_DOFS) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

function scapulae(skel: Skeleton, q: Float64Array) {
  setScapula(skel, q, 'l')
  setScapula(skel, q, 'r')
}

function sampleStand(u: number, p: P, skel: Skeleton, ctx: Ctx, v: Stand): Pose {
  const s = 1 - phaseAt(u, ctx.tempo).c
  // knees and ankles trail the hips slightly
  const sk = 1 - phaseAt(u, ctx.tempo, 0.012).c
  const knee = lerp(TOP_KNEE, KNEE[p.depth], sk)
  const df = lerp(v.topDf, ANKLE[v.holdKey][p.depth], sk)
  const q = zeroQ(skel)
  trunk(skel, q, s)
  setDofs(skel, q, { 'clavicle_*.prot': -12, 'clavicle_*.elev': 4, 'grip_*.close': 1 })
  if (v.bar) {
    for (const [i, x] of v.arms!) q[i] = x
    // bar over the midfoot (or on the Smith rail): 1-D root find on pelvis tilt
    // with the hips set by knee and ankle
    const hipMid = hipsFor(skel, v.stance, knee, df)
    const target = v.railZ ?? v.stance.midfoot[2]
    const measure = (qq: Float64Array) => barPos(skel, qq, v)[2]
    const r = root1d((tilt) => {
      setPelvis(skel, q, hipMid, tilt)
      return measure(q) - target
    }, -15, 80, { tol: 1e-7 })
    stand(skel, q, v.stance, { knee, df, tilt: r.x })
  } else {
    // no bar: trunk lean keyed, ankles bring the system COM over the midfoot
    const db = ctx.setup.implements.find((i) => i.id === 'db')!
    const upper = v.goblet ? (qq: Float64Array) => gobletArms(skel, qq, db) : (qq: Float64Array) => bodyweightArms(skel, qq, p, s)
    const measure = (qq: Float64Array) => {
      const f = fk(skel, qq)
      const loads = v.goblet ? [{ mass: DB_KG, pos: gobletPose(skel, f, db).pos }] : []
      return centerOfMass(skel, f, loads)[2]
    }
    const target = v.goblet ? 0 : UNLOADED_COM
    standBalanced(skel, q, v.stance, { knee, tilt: 3 + TILT[v.holdKey] * s }, (qq) => measure(qq) - target, upper, [-10, 40])
  }
  gaze(skel, q)
  const implements_: ImplementPose[] = []
  if (v.bar) {
    const bp: ImplementPose = { id: v.bar.id, pos: barPos(skel, q, v), rot: qid() }
    implements_.push(bp)
    if (v.railZ !== undefined) implements_.push({ id: 'smith', pos: [0, 0, 0], rot: qid() })
  } else if (v.goblet) {
    implements_.push(gobletPose(skel, fk(skel, q), ctx.setup.implements.find((i) => i.id === 'db')!))
  }
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

// ---------- leg press ----------

function pressPelvis(skel: Skeleton, q: Float64Array, shift: V3) {
  // arms rest on the side handles; the handles are placed where these angles put the hands
  setDofs(skel, q, {
    'lumbar.flex': 4, 'thorax.flex': 6, 'neck.flex': 22, 'head.flex': 10, 'clavicle_*.prot': -5, 'grip_*.close': 1,
    'shoulder_*.plane': 35, 'shoulder_*.elev': 22, 'elbow_*.flex': 55, 'forearm_*.pro': 10,
  })
  setPelvis(skel, q, add(PRESS_HIP, shift), -(PRESS_RECLINE + 10))
}

const SEAT_ROT = qmul(qaxis([1, 0, 0], -PRESS_SEAT.tilt * DEG), qfromBasis([1, 0, 0], [0, 1, 0]))
const SEAT_PAD = 0.06

/** seat pan under the pelvis, resting against the measured body (the glutes sink ~1 cm into the padding) */
function pressSeat(skel: Skeleton, f: ReturnType<typeof fk>) {
  const guess = add(localToWorld(skel, f, 'pelvis', [0, -0.12, 0.12]), [0, -0.03, 0])
  const trunkCaps = bodyCapsules(skel, f).filter((c) => c.region === 'trunk')
  return restAgainst(trunkCaps, { shape: 'box', center: guess, size: [0.42, SEAT_PAD, 0.42], rot: SEAT_ROT, pad: true }, neg(qrot(SEAT_ROT, [0, 1, 0])))
}

/** body offset from the hip point that seats the lifter on the drawn machine's seat pan */
function pressShift(skel: Skeleton): V3 {
  const q = zeroQ(skel)
  pressPelvis(skel, q, [0, 0, 0])
  const seat = pressSeat(skel, fk(skel, q))
  const n = qrot(SEAT_ROT, [0, 1, 0])
  const t = PRESS_SEAT.tilt * DEG
  const drawn = add(PRESS_HIP, add(scale([0, Math.sin(t), Math.cos(t)], PRESS_SEAT.along), scale(n, -PRESS_SEAT.drop)))
  return scale(n, dot(sub(drawn, add(seat.center, scale(n, SEAT_PAD / 2))), n))
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
  const shift = pressShift(skel)
  const q = zeroQ(skel)
  pressPelvis(skel, q, shift)
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
  const hand = (side: 'l' | 'r') => handFrame(skel, f0, side)
  const handle = (side: 'l' | 'r') => {
    const h = hand(side)
    return cyl(add(h.pos, scale(h.axis, -0.1)), add(h.pos, scale(h.axis, 0.1)), 0.016)
  }
  const handles: ImplementSpec = {
    id: 'handles',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [handle('l'), handle('r')],
    sites: { l: { pos: hand('l').pos, axis: hand('l').axis }, r: { pos: hand('r').pos, axis: hand('r').axis } },
  }
  // seat pan under the pelvis and back pad behind the trunk (static, drawn only)
  const back = norm(sub(f0.pos[skel.seg.neck1], f0.pos[skel.seg.pelvis]))
  const behind = norm(cross(back, [1, 0, 0]))
  const padRot = qfromBasis([1, 0, 0], neg(behind))
  const padGuess = add(scale(add(f0.pos[skel.seg.pelvis], f0.pos[skel.seg.neck1]), 0.5), scale(behind, 0.14))
  // pads rest against the measured body: the back and glutes sink ~1 cm into the padding
  const trunkCaps = bodyCapsules(skel, f0).filter((c) => c.region === 'trunk')
  const padBox = restAgainst(trunkCaps, { shape: 'box', center: padGuess, size: [0.4, 0.06, 0.75], rot: padRot, pad: true }, behind)
  const seatBox = pressSeat(skel, f0)
  const seatMid = seatBox.center
  const railFrom = add(PRESS_HIP, add(scale(d, s[0] + 0.05), scale(up, -0.3)))
  const railTo = add(PRESS_HIP, add(scale(d, s[1] + 0.6), scale(up, -0.3)))
  const frame: ImplementSpec = {
    id: 'press',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      padBox,
      seatBox,
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
    parts: [{ shape: 'box', center: [0, -0.02, 0.05], size: [0.75, 0.04, 0.7], pad: true }, cyl([0.3, -0.04, -0.3], [0.3, -0.12, -0.3], 0.03), cyl([-0.3, -0.04, -0.3], [-0.3, -0.12, -0.3], 0.03)],
    sites: sledSites,
  }
  // feet ride on the sled, so they are checked like grips (distance to the moving plate), not as floor contacts
  const contacts: Contact[] = [
    ...feet.flatMap((f) => ['heel', 'ball'].map((site) => ({ site: `${site}_${f.side}`, kind: 'grip' as const, target: { implement: 'sled', grip: `${site}_${f.side}` } }))),
    ...gripContacts('handles'),
  ]
  const setup: Setup = { implements: [sled, frame, handles], contacts, tempo, symmetric: true }
  return { tempo, setup, v: { kind: 'press', d, sledRot, feet: v0.feet, s, shift } }
}

function samplePress(u: number, skel: Skeleton, ctx: Ctx, v: Press): Pose {
  const c = phaseAt(u, ctx.tempo).c
  const sled = lerp(v.s[0], v.s[1], c)
  const q = zeroQ(skel)
  pressPelvis(skel, q, v.shift)
  pressLegs(skel, q, pressFeet(skel, v, sled))
  const hp: ImplementPose = { id: 'handles', pos: [0, 0, 0], rot: qid() }
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


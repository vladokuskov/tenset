import { attachHand, handFrame, plantFoot, root1d, solveLegs, type FootTarget } from '../constraints.ts'
import { centerOfMass, fk, segPos, sitePos } from '../fk.ts'
import { barbell, bench, cableHandle, ezBar, siteWorld, type ImplementSpec, type Part } from '../implements.ts'
import { add, clamp, DEG, lerp, norm, qaxis, qconj, qfromBasis, qid, qrot, RAD, scale, sub, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, minJerk, phaseAt, type Tempo } from '../timing.ts'
import { comWithDumbbells, dumbbellContacts, dumbbellPoses, handDumbbells, isWorking, sidePhase } from './arms.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { ARM_BALANCE_TOL, limitSway, makeStance, plantedContacts, setPelvis, stanceWidth, standBalanced, type StanceSetup, type Sway } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Elbow flexion ~8 -> 140 deg with the upper arm quiet (a few degrees of forward drift near the top, no shoulder
// swing or shrug). Dumbbells: joint space, forearm rotation from the grip (optionally supinating from neutral early
// in the concentric). Bars, EZ bar and cable attachments: the grip centre follows the same arm path and both hands
// are solved onto the implement. Incline (seated) and spider (prone) curls keep the upper arm vertical in the world,
// which puts it behind or in front of the torso by the bench angle. Standing variants balance body + load over the
// midfoot with the ankles.

type P = ParamsOf<'curl'>

const DB_KG = 12
const ELBOW: [number, number] = [8, 140]
/** spider curl: the forearm would hit the pad beyond this */
const SPIDER_TOP = 125
/** upper-arm forward drift at the top, deg; the spider pad holds the arm still */
const DRIFT = 10
const SPIDER_DRIFT = 2
/**
 * bars: medial tip of the elbow pole, m, added to the reference elbow vector (~0.27 m). More than this pulls the
 * elbows into the waist at the top of a shoulder-width supinated curl.
 */
const ELBOW_IN = 0.02
const TIP: Record<P['grip'], number> = { supinated: 1, neutral: 0, pronated: 0 }
/**
 * standing dumbbells: upper arm held slightly out from the side so the inner head clears the thigh at the bottom
 * (palms forward puts the whole inner head beside the thigh, a neutral grip only the plate radius), deg
 */
const DB_ABD: Record<P['grip'], number> = { supinated: 12, neutral: 8, pronated: 8 }
const FOREARM: Record<P['grip'], number> = { supinated: -80, neutral: 0, pronated: 75 }
const SEAT_HIP: V3 = [0, 0.56, 0]
const SPIDER_HIP: V3 = [0, 0.9, 0]

type Body = 'stand' | 'incline' | 'spider'

type Ctx = {
  tempo: Tempo
  setup: Setup
  body: Body
  stance?: StanceSetup
  feet?: FootTarget[]
  /** rope: the strands bend at the fist, so the hands keep the reference orientation instead of lining up with them */
  bar?: { spec: ImplementSpec; sites: [string, string]; pulley?: V3; cable: boolean; grip: P['grip']; rope?: boolean }
  benchPose?: ImplementPose
  barBottom?: number
  measure?: (q: Float64Array) => number
  sway?: Sway
}

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

function bodyOf(p: P): Body {
  if (p.posture === 'seated') return 'incline'
  if (p.posture === 'lying_prone') return 'spider'
  return 'stand'
}

function unsupported(p: P) {
  if (p.implement !== 'dumbbell' && p.posture !== 'standing') return `${p.implement}/${p.posture}`
  if (p.implement === 'cable' && p.attachment !== 'straight_bar' && p.attachment !== 'rope') return `cable ${p.attachment ?? 'no attachment'}`
  return null
}

/** reclined back (incline) or chest on the pad (spider): trunk angle from vertical, deg (+ forward) */
function trunkAngle(p: P, body: Body) {
  const a = p.benchAngle ?? 45
  return body === 'incline' ? -(90 - a) : body === 'spider' ? 90 - a : 0
}

// ---------- bodies ----------

function supportedBody(skel: Skeleton, q: Float64Array, p: P, ctx: Pick<Ctx, 'body' | 'feet'>) {
  const t = trunkAngle(p, ctx.body)
  setDofs(skel, q, { 'lumbar.flex': 2, 'thorax.flex': 4, 'neck.flex': ctx.body === 'spider' ? -25 : 10, 'head.flex': ctx.body === 'spider' ? -10 : 0 })
  setPelvis(skel, q, ctx.body === 'spider' ? SPIDER_HIP : SEAT_HIP, t - 6)
  solveLegs(skel, q, ctx.feet!)
}

function supportedContext(p: P, skel: Skeleton, body: Body) {
  const hip = body === 'spider' ? SPIDER_HIP : SEAT_HIP
  const half = skel.segments[skel.seg.femur_l].offset[0] + (body === 'spider' ? 0.08 : 0.06)
  const z = body === 'spider' ? hip[2] - 0.12 : hip[2] + skel.segments[skel.seg.femur_l].length + 0.1
  const feet = [plantFoot(skel, 'l', [half, 0, z], 12), plantFoot(skel, 'r', [-half, 0, z], 12)]
  const q = zeroQ(skel)
  supportedBody(skel, q, p, { body, feet })
  const f = fk(skel, q)
  // pad along the trunk: behind the back (incline) or under the chest with its top edge at the armpits (spider)
  const pelvis = segPos(skel, f, 'pelvis')
  const neck = segPos(skel, f, 'neck1')
  const up = norm(sub(neck, pelvis))
  const out = norm(qrot(f.rot[skel.seg.thorax2], [0, 0, body === 'spider' ? 1 : -1]))
  const a = p.benchAngle ?? 45
  let spec: ImplementSpec
  let pose: ImplementPose
  if (body === 'incline') {
    const hinge = add(add(pelvis, scale(out, 0.15)), scale(up, -0.08))
    spec = bench({ backAngle: a, seatHeight: hinge[1] })
    pose = { id: spec.id, pos: hinge, rot: qid() }
  } else {
    const gh = scale(add(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r')), 0.5)
    const top = add(add(gh, scale(out, 0.14)), scale(up, -0.06))
    const hinge = sub(top, scale(up, 0.84))
    spec = bench({ backAngle: a, seatHeight: hinge[1] })
    // the pad rises towards +Z, so the lifter faces it from the seat end
    pose = { id: spec.id, pos: hinge, rot: qaxis([0, 1, 0], Math.PI) }
  }
  const contacts: Contact[] = []
  for (const ft of feet) for (const site of ['heel', 'ball']) {
    const name = `${site}_${ft.side}`
    contacts.push({ site: name, kind: 'planted', target: { world: add(ft.ankle, qrot(ft.rot, skel.data.sites[name].local)) } })
  }
  return { feet, bench: spec, benchPose: pose, contacts }
}

// ---------- arms ----------

/**
 * Humerus direction for elbow phase c: vertical in the world (drifting forward near the top) or, with
 * shoulderFlexion, fixed relative to the torso. Returns plane/elev relative to the thorax.
 */
function upperArm(skel: Skeleton, q: Float64Array, p: P, side: 'l' | 'r', cl: number, abd = 0) {
  const drift = (p.posture === 'lying_prone' ? SPIDER_DRIFT : DRIFT) * cl * cl
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  const sa = Math.sin(abd * DEG) * (side === 'l' ? 1 : -1)
  const ca = Math.cos(abd * DEG)
  let d: V3
  if (p.shoulderFlexion !== undefined) {
    const a = (p.shoulderFlexion + drift) * DEG
    d = [sa, -Math.cos(a) * ca, Math.sin(a) * ca]
  } else {
    const a = drift * DEG
    d = qrot(qconj(thorax), [sa, -Math.cos(a) * ca, Math.sin(a) * ca])
  }
  const m = side === 'l' ? d : ([-d[0], d[1], d[2]] as V3)
  const elev = Math.acos(clamp(-m[1], -1, 1)) * RAD
  // sagittal humerus: plane is +90 (in front of the torso) or -90 (behind); near vertical keep a forward plane
  const plane = elev < 2 ? 90 : Math.atan2(m[2], Math.max(0, m[0])) * RAD
  return { plane, elev }
}

function forearm(p: P, cl: number) {
  if (p.supinate && p.implement === 'dumbbell') return lerp(0, FOREARM.supinated, minJerk(cl / 0.8))
  return FOREARM[p.grip]
}

function topElbow(body: Body) {
  return body === 'spider' ? SPIDER_TOP : ELBOW[1]
}

/** c drives the elbow; cl (slightly lagged) the upper-arm drift and forearm rotation */
function dbArm(skel: Skeleton, q: Float64Array, side: 'l' | 'r', c: number, cl: number, p: P, body: Body, bottom = ELBOW[0]) {
  const d = skel.dof
  const abd = body === 'stand' && p.implement === 'dumbbell' ? DB_ABD[p.supinate ? 'neutral' : p.grip] : 0
  const ua = upperArm(skel, q, p, side, cl, abd)
  q[d[`shoulder_${side}.plane`]] = ua.plane
  q[d[`shoulder_${side}.elev`]] = ua.elev
  q[d[`shoulder_${side}.rot`]] = 0
  q[d[`elbow_${side}.flex`]] = lerp(bottom, topElbow(body), c)
  q[d[`forearm_${side}.pro`]] = forearm(p, cl)
  q[d[`wrist_${side}.flex`]] = 6 * c
  q[d[`clavicle_${side}.prot`]] = -3
  q[d[`clavicle_${side}.elev`]] = 0
  q[d[`grip_${side}.close`]] = 1
}

// ---------- bars and cable attachments ----------

function ropeSpec(): ImplementSpec {
  const base = cableHandle({ id: 'handle', attachment: 'rope' })
  // the rope strands spread; hands a little narrower than the shoulders
  return {
    ...base,
    parts: [cyl([0, 0, 0], [0.16, -0.3, 0], 0.012), cyl([0, 0, 0], [-0.16, -0.3, 0], 0.012)],
    sites: { l: { pos: [0.14, -0.26, 0], axis: norm([0.16, -0.3, 0]) }, r: { pos: [-0.14, -0.26, 0], axis: norm([-0.16, -0.3, 0]) } },
  }
}

function barSetup(p: P, skel: Skeleton): NonNullable<Ctx['bar']> {
  const g = (p.gripWidth * skel.data.shoulderWidth) / 2
  if (p.implement === 'barbell') return { spec: barbell({ gripWidth: 2 * g, plateKg: 5 }), sites: ['l', 'r'], cable: false, grip: p.grip }
  if (p.implement === 'ez_bar') {
    const base = ezBar({ plateKg: 5 })
    if (p.grip !== 'pronated') return { spec: base, sites: ['l_in', 'r_in'], cable: false, grip: p.grip }
    // reverse grip: hands on the inner end of the outer bends, which angle the palms for pronation
    const x = 0.265
    const z = 0.03 * (1 - (x - 0.25) / 0.1)
    const spec: ImplementSpec = { ...base, sites: { ...base.sites, lp: { pos: [x, 0, z], axis: base.sites.l.axis }, rp: { pos: [-x, 0, z], axis: base.sites.r.axis } } }
    return { spec, sites: ['lp', 'rp'], cable: false, grip: p.grip }
  }
  if (p.attachment === 'rope') return { spec: ropeSpec(), sites: ['l', 'r'], cable: true, grip: p.grip, rope: true }
  const base = cableHandle({ id: 'handle', attachment: 'straight_bar' })
  const w = Math.max(0.25, g + 0.07)
  return {
    spec: { ...base, parts: [cyl([0, 0, 0], [0, -0.05, 0], 0.01), cyl([-w, -0.05, 0], [w, -0.05, 0], 0.014)], sites: { l: { pos: [g, -0.05, 0], axis: [1, 0, 0] }, r: { pos: [-g, -0.05, 0], axis: [1, 0, 0] } } },
    sites: ['l', 'r'],
    cable: true,
    grip: p.grip,
  }
}

/** implement pose that puts the grip midpoint on `center`: bars turn with the forearms, cable attachments hang towards the pulley */
function barPose(bar: NonNullable<Ctx['bar']>, center: V3, pitch: number): ImplementPose {
  const rot = bar.cable ? qfromBasis([1, 0, 0], norm(sub(bar.pulley!, center))) : qaxis([1, 0, 0], -pitch * DEG)
  const mid = scale(add(bar.spec.sites[bar.sites[0]].pos, bar.spec.sites[bar.sites[1]].pos), 0.5)
  return { id: bar.spec.id, pos: sub(center, qrot(rot, mid)), rot }
}

function barArms(skel: Skeleton, q: Float64Array, bar: NonNullable<Ctx['bar']>, pose: ImplementPose, ref: Float64Array) {
  // follow the reference arm: same bend plane (elbows back at the sides) and palm direction
  const f = fk(skel, ref)
  for (const side of ['l', 'r'] as const) {
    const g = siteWorld(bar.spec, pose, bar.sites[side === 'l' ? 0 : 1])
    const elbowDir = sub(segPos(skel, f, `forearm_${side}`), segPos(skel, f, `humerus_${side}`))
    const h = handFrame(skel, f, side)
    // tipping the bend plane medially rotates the humerus out (supinated grips), laterally rotates it in (pronated)
    const lat = side === 'l' ? 1 : -1
    attachHand(skel, q, side, { pos: g.pos, axis: g.axis!, palm: h.palm, hand: bar.rope ? h.rot : undefined }, { pole: add(elbowDir, [-lat * ELBOW_IN * TIP[bar.grip], 0, -0.1]), planeHint: 90 })
  }
}

/**
 * Bars: a symmetric reference arm sets the grip path and the balance; the hands are then solved onto the bar.
 * The reference stops at `bottom` elbow flexion (calibrated so the real, wider-set arms end near ELBOW[0]).
 */
function barFrame(skel: Skeleton, q: Float64Array, p: P, ctx: Ctx, c: number, cl: number, bottom = ctx.barBottom!, sway = ctx.sway) {
  const bar = ctx.bar!
  const ref = (qq: Float64Array) => {
    dbArm(skel, qq, 'l', c, cl, p, 'stand', bottom)
    dbArm(skel, qq, 'r', c, cl, p, 'stand', bottom)
  }
  const center = (qq: Float64Array): V3 => {
    const g = sitePos(skel, fk(skel, qq), 'grip_l')
    return [0, g[1], g[2]]
  }
  const measure = (qq: Float64Array) => centerOfMass(skel, fk(skel, qq), [{ mass: bar.spec.mass, pos: center(qq) }])[2]
  const bal = standBalanced(skel, q, ctx.stance!, { knee: 6, tilt: 2 }, measure, ref, undefined, sway)
  const refQ = Float64Array.from(q)
  const d = skel.dof
  const pitch = q[d['shoulder_l.elev']] * (q[d['shoulder_l.plane']] >= 0 ? 1 : -1) + q[d['elbow_l.flex']]
  const pose = barPose(bar, center(q), pitch)
  barArms(skel, q, bar, pose, refQ)
  return { pose, bal }
}

function standingBase(skel: Skeleton) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': -1, 'thorax.flex': 1, 'neck.flex': -3 })
  return q
}

// ---------- context ----------

const context = memo((p: P, skel: Skeleton): Ctx => {
  const why = unsupported(p)
  if (why) throw new Error(`curl: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const body = bodyOf(p)
  const symmetric = p.laterality === 'bilateral'
  if (body !== 'stand') {
    const s = supportedContext(p, skel, body)
    const setup: Setup = {
      implements: [...handDumbbells(DB_KG), s.bench],
      contacts: [...s.contacts, ...dumbbellContacts()],
      tempo,
      symmetric,
    }
    return { tempo, setup, body, feet: s.feet, benchPose: s.benchPose }
  }
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const contacts = plantedContacts(skel, stance)
  if (p.implement === 'dumbbell') {
    const setup: Setup = {
      implements: handDumbbells(DB_KG),
      contacts: [...contacts, ...dumbbellContacts()],
      tempo,
      symmetric,
      balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL },
    }
    const ctx: Ctx = { tempo, setup, body, stance, measure: comWithDumbbells(skel, DB_KG) }
    ctx.sway = limitSway((u, sway) => standDumbbells(skel, standingBase(skel), u, p, ctx, sway))
    return ctx
  }
  const bar = barSetup(p, skel)
  const implements_: ImplementSpec[] = [bar.spec]
  if (bar.cable) {
    // low pulley on the floor in front of the feet, drawn as a short column
    bar.pulley = [0, 0.08, stance.midfoot[2] + 0.5]
    implements_.push({
      id: 'stack',
      kind: 'bench',
      mass: 0,
      com: [0, 0, 0],
      parts: [cyl([0, 0, bar.pulley[2] + 0.12], [0, 2.1, bar.pulley[2] + 0.12], 0.05), cyl([0, bar.pulley[1], bar.pulley[2]], [0, bar.pulley[1], bar.pulley[2] + 0.12], 0.04)],
      sites: {},
    })
  }
  contacts.push(
    { site: 'grip_l', kind: 'grip', target: { implement: bar.spec.id, grip: bar.sites[0] } },
    { site: 'grip_r', kind: 'grip', target: { implement: bar.spec.id, grip: bar.sites[1] } },
  )
  const setup: Setup = { implements: implements_, contacts, tempo, symmetric: true, balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL } }
  const ctx: Ctx = { tempo, setup, body, stance, bar }
  const elbowAt = (bottom: number) => {
    const q = standingBase(skel)
    barFrame(skel, q, p, ctx, 0, 0, bottom)
    return q[skel.dof['elbow_l.flex']]
  }
  ctx.barBottom = root1d((b) => elbowAt(b) - ELBOW[0], 0, 45, { tol: 1e-4 }).x
  // cable loads are the handle only, so the body barely needs to sway anyway
  ctx.sway = limitSway((u, sway) => {
    const { c, cl } = phases(u, p, tempo, 'l')
    return barFrame(skel, standingBase(skel), p, ctx, c, cl, ctx.barBottom, sway).bal
  })
  return ctx
})

// ---------- sampling ----------

function phases(u: number, p: P, tempo: Tempo, side: 'l' | 'r') {
  const us = sidePhase(u, side, p.laterality)
  const on = isWorking(side, p.laterality, p.side)
  return { c: on ? phaseAt(us, tempo).c : 0, cl: on ? phaseAt(us, tempo, 0.015).c : 0 }
}

function standDumbbells(skel: Skeleton, q: Float64Array, u: number, p: P, ctx: Ctx, sway?: Sway) {
  const upper = (qq: Float64Array) => {
    for (const s of ['l', 'r'] as const) {
      const { c, cl } = phases(u, p, ctx.tempo, s)
      dbArm(skel, qq, s, c, cl, p, 'stand')
    }
  }
  return standBalanced(skel, q, ctx.stance!, { knee: 6, tilt: 2 }, ctx.measure!, upper, undefined, sway)
}

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const q = zeroQ(skel)
  if (ctx.body !== 'stand') {
    supportedBody(skel, q, p, ctx)
    for (const s of ['l', 'r'] as const) {
      const { c, cl } = phases(u, p, ctx.tempo, s)
      dbArm(skel, q, s, c, cl, p, ctx.body)
    }
    return { q, implements: [...dumbbellPoses(skel, q), ctx.benchPose!], contacts: ctx.setup.contacts }
  }
  q.set(standingBase(skel))
  if (!ctx.bar) {
    standDumbbells(skel, q, u, p, ctx, ctx.sway)
    return { q, implements: dumbbellPoses(skel, q), contacts: ctx.setup.contacts }
  }
  const bar = ctx.bar
  const { c, cl } = phases(u, p, ctx.tempo, 'l')
  const { pose } = barFrame(skel, q, p, ctx, c, cl)
  const implements_: ImplementPose[] = [pose]
  if (bar.cable) implements_.push({ id: 'stack', pos: [0, 0, 0], rot: qid() })
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

export const curl: Template<P> = {
  id: 'curl',
  driver: 'joint',
  params: SCHEMAS.curl,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}


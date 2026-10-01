import { attachHand, root1d } from '../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts, restAgainst } from '../collide.ts'
import { fk, localToWorld, segPos } from '../fk.ts'
import { catchPad, kneeLever, kneeMachine, machineHandles, NORDIC, nordicStation, padBox } from '../implements/legs-knee.ts'
import type { ImplementSpec } from '../implements.ts'
import { lerp, norm, qalign, qid, type Quat, type V3 } from '../math.ts'
import { setDofs, setScapula, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, minJerk, phaseAt, type Tempo } from '../timing.ts'
import { kneeAxis, leverPose, mirroredArms, rollerOnShins, ROLLER_ALONG, seatedMachine, seatedPose, SINK, type SeatedMachine } from './knee-machine.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { setPelvis } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Leg curl, joint space. Machines: the knee flexes from a near-straight stretch to a deep curl (research: knee ~5 ->
// ~110-130) about the machine pivot with the hips held still (seated at the record's hip angle, Maeo 2021; lying prone
// on a two-level pad, chest lower than the hips). Nordic: kneeling with the ankles under a roller, the body stays
// straight from knees to head and lowers under control until the hands catch on a mat in a push-up position, then
// pushes off and curls back up to kneeling.

type P = ParamsOf<'leg-curl'>

export const SEATED = { stretch: 6, curl: 118 }
export const LYING = { stretch: 8, curl: 115 }
/** kneeling upright (thighs vertical) down to the catch */
export const NORDIC_KNEE = { top: 90, catch: 22 }

const LYING_HIP: V3 = [0, 0.8, 0]
const KNEEL_PAD_TOP = 0.11
/** arms: hands held up in front of the chest while lowering; they reach for the mat over the last part of the drop */
const READY = { 'shoulder_*.plane': 85, 'shoulder_*.elev': 38, 'shoulder_*.rot': 10, 'elbow_*.flex': 105, 'forearm_*.pro': 75, 'wrist_*.flex': -15, 'wrist_*.dev': 0 }
const REACH_FROM = 0.45
/** latest concentric progress with the hands still pushing on the mat, the elbow angle they let go at (a short press,
 * so the arms can swing back up without overshooting), and the progress by which the arms are back up */
const PUSH_UNTIL = 0.3
const RELEASE_ELBOW = 66
const LET_GO_BY = 0.9
const CATCH_ARMS = ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']

type Seated = { kind: 'seated'; m: SeatedMachine }
type Lying = { kind: 'lying'; machine: ImplementSpec; lever: ImplementSpec; handles: ImplementSpec; pivot: V3; arms: [number, number][] }
type Nordic = {
  kind: 'nordic'
  catchAt: Record<'l' | 'r', V3>
  hand: Record<'l' | 'r', Quat>
  matZ: number
  roll: (knee: number) => number
  /** arm DOFs (catchIdx order): hands up in front of the chest, planted at the catch, letting go of the mat */
  ready: number[]
  caught: number[]
  release: number[]
  releaseRate: number[]
  releaseAcc: number[]
  /** concentric progress where the hands let go of the mat */
  pushUntil: number
}
type Ctx = { tempo: Tempo; setup: Setup; v: Seated | Lying | Nordic }

function unsupported(p: P) {
  if (p.laterality !== 'bilateral') return p.laterality
  if (p.implement === 'machine') return p.machine === 'leg_curl_lying' ? (p.posture === 'lying_prone' ? null : p.posture) : p.posture === 'seated' ? null : p.posture
  if (p.implement === 'bodyweight') return p.posture === 'kneeling' ? null : `bodyweight/${p.posture}`
  return p.implement
}

const handContacts = (id: string): Contact[] => [
  { site: 'grip_l', kind: 'grip', target: { implement: id, grip: 'l' } },
  { site: 'grip_r', kind: 'grip', target: { implement: id, grip: 'r' } },
]

// ---------- lying ----------

function proneBody(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'hip_*.flex': 0, 'lumbar.flex': -4, 'thorax.flex': 2, 'neck.flex': -30, 'head.flex': -12, 'ankle_*.df': 2, 'clavicle_*.prot': 6, 'grip_*.close': 1 })
  setPelvis(skel, q, LYING_HIP, 90)
}

function lyingContext(skel: Skeleton, tempo: Tempo): Ctx {
  const q = zeroQ(skel)
  proneBody(skel, q)
  setDofs(skel, q, { 'knee_*.flex': LYING.stretch })
  const caps = bodyCapsules(skel, fk(skel, q))
  const pivot = kneeAxis(skel, q)
  const hz = LYING_HIP[2]
  // hip pad from just above the knees to the lower belly; the chest reaches deeper, so its pad sits lower
  const rear = pivot[2] + 0.05, front = hz + 0.16
  const legs = caps.filter((c) => /^(thigh_[lr]|trunk)$/.test(c.region))
  const hip = restAgainst(legs, padBox([0, LYING_HIP[1] - 0.25, (rear + front) / 2], [0.36, 0.07, front - rear]), [0, -1, 0], SINK)
  const chestCaps = caps.filter((c) => c.region === 'trunk' && /^(thorax|lumbar3)/.test(c.segment))
  const chest = restAgainst(chestCaps, padBox([0, LYING_HIP[1] - 0.3, hz + 0.4], [0.36, 0.07, 0.36]), [0, -1, 0], SINK)
  const lever = kneeLever({ roller: [0, rollerOnShins(caps, leverPose(pivot, LYING.stretch, 180), false), ROLLER_ALONG] })
  // handles below the front of the chest pad, forearms hanging towards them
  const chestTop = chest.center[1] + chest.size[1] / 2
  const hold = (s: 1 | -1) => ({ pos: [s * 0.25, chestTop - 0.3, hz + 0.72] as V3, axis: norm([0, 0.35, 1]) })
  const handles = machineHandles({ l: hold(1), r: hold(-1) })
  attachHand(skel, q, 'l', { pos: hold(1).pos, axis: hold(1).axis, palm: [-1, 0, 0] }, { pole: [1, 0.2, -0.4], planeHint: 120, wristBias: 5 })
  const machine = kneeMachine({ kind: 'leg_curl_lying', pads: { hip, chest }, pivot, stack: [0.62, 0, hz + 0.05] })
  const setup: Setup = { implements: [machine, lever, handles], contacts: handContacts(handles.id), tempo, symmetric: true }
  return { tempo, setup, v: { kind: 'lying', machine, lever, handles, pivot, arms: mirroredArms(skel, q) } }
}

function sampleLying(u: number, skel: Skeleton, ctx: Ctx, v: Lying): Pose {
  const knee = lerp(LYING.stretch, LYING.curl, phaseAt(u, ctx.tempo).c)
  const q = zeroQ(skel)
  proneBody(skel, q)
  for (const [i, x] of v.arms) q[i] = x
  setDofs(skel, q, { 'knee_*.flex': knee })
  const fixed = { pos: [0, 0, 0] as V3, rot: qid() }
  return { q, implements: [{ id: v.machine.id, ...fixed }, leverPose(v.pivot, knee, 180), { id: v.handles.id, ...fixed }], contacts: ctx.setup.contacts }
}

// ---------- Nordic ----------

/** ankle axis of the floor Nordic station, under the roller: the shins lie level on the kneeling pad */
const NORDIC_ANKLE: V3 = [0, 0.145, -0.463]
/** the ankle roller's pad sits this far into the shins kneeling upright: they press 4-5 mm deeper at the catch */
const ROLLER_SINK = -0.007
/** the kneecaps may press this far into the pad before the knees roll up onto them */
const KNEE_PRESS = -0.012

/**
 * kneeling body at knee flexion k with the hips straight: the shins pivot about the anchored ankles, `roll` (deg)
 * lifting the knee end as the knees straighten and the weight moves onto the kneecaps
 */
function kneelBody(skel: Skeleton, q: Float64Array, knee: number, roll = 0) {
  const lean = 90 - knee
  const hip = 2
  setDofs(skel, q, {
    'hip_*.flex': hip, 'knee_*.flex': knee, 'ankle_*.df': -48, 'lumbar.flex': 1, 'thorax.flex': 3, 'clavicle_*.prot': 4, 'grip_*.close': 0,
    // eyes ahead of the hands: the head comes up as the body tips forward
    'neck.flex': 8 - 0.45 * lean, 'head.flex': 4 - 0.15 * lean,
  })
  setPelvis(skel, q, [0, 1, 0], hip - knee + 90 - roll)
  const shin = skel.segments[skel.seg.tibia_l].length
  const r = (roll * Math.PI) / 180
  const target: V3 = [NORDIC_ANKLE[0], NORDIC_ANKLE[1] + shin * Math.sin(r), NORDIC_ANKLE[2] + shin * Math.cos(r)]
  const k = kneeAxis(skel, q)
  const d = skel.dof
  q[d['pelvis.tx']] += target[0] - k[0]
  q[d['pelvis.ty']] += target[1] - k[1]
  q[d['pelvis.tz']] += target[2] - k[2]
}

function readyArms(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, READY)
  setScapula(skel, q, 'l')
  setScapula(skel, q, 'r')
}

/** hand flat on the mat: palm down, fingers forward and turned out (less pronation, elbows back) */
function catchHand(skel: Skeleton, side: 'l' | 'r'): Quat {
  const n = skel.data.sites[`grip_${side}`].normal!
  return qalign(n, [0, -1, 0], [0, -1, 0], norm([side === 'l' ? 0.45 : -0.45, 0, 1]))
}

function catchArms(skel: Skeleton, q: Float64Array, v: Pick<Nordic, 'catchAt' | 'hand'>) {
  for (const s of ['l', 'r'] as const) {
    attachHand(skel, q, s, { pos: v.catchAt[s], axis: [1, 0, 0], palm: [0, -1, 0], hand: v.hand[s] }, { pole: [s === 'l' ? 1 : -1, 0, -0.3], planeHint: 80 })
  }
}

const catchIdx = (skel: Skeleton) => CATCH_ARMS.flatMap((k) => ['l', 'r'].map((s) => skel.dof[k.replace('*', s)]))

/** arm DOFs with the hands planted on the mat at knee flexion k */
function plantedArms(skel: Skeleton, v: Pick<Nordic, 'catchAt' | 'hand' | 'roll'>, knee: number): number[] {
  const q = zeroQ(skel)
  kneelBody(skel, q, knee, v.roll(knee))
  readyArms(skel, q)
  catchArms(skel, q, v)
  return catchIdx(skel).map((i) => q[i])
}

function nordicContext(skel: Skeleton, tempo: Tempo): Ctx {
  const q = zeroQ(skel)
  kneelBody(skel, q, NORDIC_KNEE.top)
  const caps = bodyCapsules(skel, fk(skel, q))
  const axis = kneeAxis(skel, q)
  // the shins lie on the kneeling pad; the roller rests on the backs of the lower shins
  const shins = caps.filter((c) => /^shank_/.test(c.region))
  const legCaps = caps.filter((c) => /^(thigh|shank)_/.test(c.region))
  const pad = restAgainst(legCaps, padBox([0, KNEEL_PAD_TOP - NORDIC.knee.thick / 2, axis[2] - 0.13], [NORDIC.knee.width, NORDIC.knee.thick, NORDIC.knee.depth]), [0, -1, 0], SINK)
  const kneePad: V3 = [0, pad.center[1] + pad.size[1] / 2, pad.center[2]]
  const along = axis[2] - 0.36
  const roller = restAgainst(shins, { shape: 'cylinder', a: [-NORDIC.roller.half, axis[1] + 0.1, along], b: [NORDIC.roller.half, axis[1] + 0.1, along], r: NORDIC.roller.r, pad: true }, [0, 1, 0], ROLLER_SINK)
  const station = nordicStation({ kneePad, roller: [0, roller.a[1], along] })

  // knee roll per knee angle: the smallest lift that keeps the knees within KNEE_PRESS of the pad
  const [padSolid] = placeParts({ ...station, parts: [pad] }, { id: 'pad', pos: [0, 0, 0], rot: qid() })
  const legs = (knee: number, roll: number) => {
    const qq = zeroQ(skel)
    kneelBody(skel, qq, knee, roll)
    return Math.min(...bodyCapsules(skel, fk(skel, qq)).filter((c) => /^(thigh|shank)_/.test(c.region)).map((c) => capsuleSolidClearance(c, padSolid)))
  }
  const knees = Array.from({ length: 15 }, (_, i) => lerp(NORDIC_KNEE.catch, NORDIC_KNEE.top, i / 14))
  const rolls = knees.map((k) => (legs(k, 0) >= KNEE_PRESS ? 0 : root1d((r) => legs(k, r) - KNEE_PRESS, 0, 15, { tol: 1e-6 }).x))
  const roll = monotone(knees, rolls)

  // hands land under and a little ahead of the shoulders at the bottom, on the catch mat
  kneelBody(skel, q, NORDIC_KNEE.catch, roll(NORDIC_KNEE.catch))
  const f = fk(skel, q)
  const hand = { l: catchHand(skel, 'l'), r: catchHand(skel, 'r') }
  const catchAt = {} as Record<'l' | 'r', V3>
  for (const s of ['l', 'r'] as const) {
    const sh = segPos(skel, f, `humerus_${s}`)
    catchAt[s] = [sh[0] + (s === 'l' ? 0.05 : -0.05), NORDIC.catch.thick, sh[2] + 0.2]
  }
  // arms: the catch pose, the pose where the push-off lets go and its rate of change (per unit concentric progress)
  const base = { catchAt, hand, roll }
  const kneeAt = (x: number) => lerp(NORDIC_KNEE.catch, NORDIC_KNEE.top, minJerk(x))
  const caught = plantedArms(skel, base, NORDIC_KNEE.catch)
  // the hands push until the elbows are nearly straight, then let go
  const elbow = catchIdx(skel).indexOf(skel.dof['elbow_l.flex'])
  const pushUntil = Math.min(PUSH_UNTIL, root1d((x) => plantedArms(skel, base, kneeAt(x))[elbow] - RELEASE_ELBOW, 0.02, 0.5, { tol: 1e-5 }).x)
  const h = 2e-3
  const release = plantedArms(skel, base, kneeAt(pushUntil))
  const b1 = plantedArms(skel, base, kneeAt(pushUntil - h)), b2 = plantedArms(skel, base, kneeAt(pushUntil - 2 * h))
  const releaseRate = release.map((x, i) => (3 * x - 4 * b1[i] + b2[i]) / (2 * h))
  const releaseAcc = release.map((x, i) => (x - 2 * b1[i] + b2[i]) / (h * h))
  readyArms(skel, q)
  const ready = catchIdx(skel).map((i) => q[i])
  const mat = catchPad()
  const palms: ImplementSpec[] = (['l', 'r'] as const).map((s) => ({ id: `palm_${s}`, kind: 'hand_pose', mass: 0, com: [0, 0, 0], parts: [], sites: { c: { pos: [0, 0, 0] } } }))
  const setup: Setup = {
    implements: [station, mat, ...palms],
    contacts: (['l', 'r'] as const).map((s) => ({ site: `grip_${s}`, kind: 'grip' as const, target: { implement: `palm_${s}`, grip: 'c' } })),
    tempo,
    symmetric: true,
    // the hand's collision model is a closed fist: a flat palm on the mat reads as the fist sinking into it
    rests: [{ implement: mat.id, regions: ['hand_l', 'hand_r'], tol: 42 }],
  }
  // the hands land in the rear half of the mat, the head and chest come down over its front
  return { tempo, setup, v: { kind: 'nordic', catchAt, hand, matZ: catchAt.l[2] + 0.1, roll, ready, caught, release, releaseRate, releaseAcc, pushUntil } }
}

/** piecewise-cubic Hermite through (xs, ys) with Fritsch-Carlson tangents: smooth and without overshoot */
function monotone(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length
  const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]))
  const m = xs.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i])))
  return (x) => {
    const k = Math.min(n - 2, Math.max(0, Math.floor(((x - xs[0]) / (xs[n - 1] - xs[0])) * (n - 1))))
    const h = xs[k + 1] - xs[k], t = Math.min(1, Math.max(0, (x - xs[k]) / h))
    const t2 = t * t, t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1]
  }
}

function sampleNordic(u: number, skel: Skeleton, ctx: Ctx, v: Nordic): Pose {
  const ph = phaseAt(u, ctx.tempo)
  const c = ph.c
  const knee = lerp(NORDIC_KNEE.catch, NORDIC_KNEE.top, c)
  const q = zeroQ(skel)
  kneelBody(skel, q, knee, v.roll(knee))
  // arms: up in front of the chest, reaching for the mat over the end of the drop, planted through the pause and the
  // start of the rise (IK), then a smooth hand-off back up (Hermite from the release pose and rate)
  readyArms(skel, q)
  const idx = catchIdx(skel)
  if (ph.name === 'ecc') {
    const w = minJerk((1 - c - REACH_FROM) / (1 - REACH_FROM))
    idx.forEach((i, n) => (q[i] = lerp(v.ready[n], v.caught[n], w)))
  } else if (ph.name === 'bottom') idx.forEach((i, n) => (q[i] = v.caught[n]))
  else if (ph.name === 'con' && ph.progress <= v.pushUntil) catchArms(skel, q, v)
  else if (ph.name === 'con') {
    // quintic Hermite: position, rate and acceleration of the push at the release, at rest in the ready pose
    const S = LET_GO_BY - v.pushUntil
    const t = Math.min(1, (ph.progress - v.pushUntil) / S)
    const t3 = t ** 3, t4 = t ** 4, t5 = t ** 5
    const h0 = 1 - 10 * t3 + 15 * t4 - 6 * t5, h1 = t - 6 * t3 + 8 * t4 - 3 * t5, h2 = 0.5 * t * t - 1.5 * t3 + 1.5 * t4 - 0.5 * t5
    idx.forEach((i, n) => (q[i] = h0 * v.release[n] + h1 * S * v.releaseRate[n] + h2 * S * S * v.releaseAcc[n] + (1 - h0) * v.ready[n]))
  }
  const f = fk(skel, q)
  const palm = (s: 'l' | 'r'): ImplementPose => ({ id: `palm_${s}`, pos: localToWorld(skel, f, `hand_${s}`, skel.data.sites[`grip_${s}`].local), rot: qid() })
  return {
    q,
    implements: [{ id: 'nordic', pos: [0, 0, 0], rot: qid() }, { id: 'catch', pos: [0, 0, v.matZ], rot: qid() }, palm('l'), palm('r')],
    contacts: ctx.setup.contacts,
  }
}

// ---------- template ----------

const context = memo((p: P, skel: Skeleton): Ctx => {
  const why = unsupported(p)
  if (why) throw new Error(`leg-curl: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.implement === 'bodyweight') return nordicContext(skel, tempo)
  if (p.machine === 'leg_curl_lying') return lyingContext(skel, tempo)
  const m = seatedMachine(skel, { hipAngle: p.hipAngle, kind: 'leg_curl_seated', knee: SEATED.stretch })
  const setup: Setup = { implements: [m.machine, m.lever, m.handles], contacts: m.contacts, tempo, symmetric: true }
  return { tempo, setup, v: { kind: 'seated', m } }
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const v = ctx.v
  if (v.kind === 'lying') return sampleLying(u, skel, ctx, v)
  if (v.kind === 'nordic') return sampleNordic(u, skel, ctx, v)
  const knee = lerp(SEATED.stretch, SEATED.curl, phaseAt(u, ctx.tempo).c)
  const q = zeroQ(skel)
  return { q, implements: seatedPose(skel, v.m, p.hipAngle, knee, q), contacts: ctx.setup.contacts }
}

export const legCurl: Template<P> = {
  id: 'leg-curl',
  driver: 'joint',
  params: SCHEMAS['leg-curl'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}

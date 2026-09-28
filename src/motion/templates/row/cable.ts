import { handFrame, implementFromHand, plantFoot, root1d, solveLegs, type FootTarget } from '../../constraints.ts'
import { centerOfPressure, fk, localToWorld, segPos } from '../../fk.ts'
import { cableForce, cableHandle, comWorld, type ImplementSpec, type Part } from '../../implements.ts'
import { add, cross, dist, norm, qfromBasis, qfromTo, qid, qrot, reject, scale, sub, type V3 } from '../../math.ts'
import { setDofs, setScapula, shoulderRhythm, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { ARM_BALANCE_TOL, limitSway, makeStance, plantedContacts, setPelvis, stanceWidth, standBalanced, type StanceSetup, type Sway } from '../standing.ts'
import type { Setup } from '../types.ts'
import { elbowPole, lerp, monotoneCubic, other, phases, PROT, reach, working, type P, type Side } from './common.ts'

// Standing cable rows off a single-column stack in front of the lifter.
// Face pull (206, finish external_rotation): rope at upper-chest to eye height; joint space. The arms start forward
// with the shoulders reaching, the scapulae set back, the elbows drive out and back at shoulder height (elbowFlare
// 90) while the rope ends split apart, and the last third externally rotates the upper arms so the hands finish
// beside the ears. Hip-width stance, the body leaning a little against the cable.
// Single-arm (315): split stance (free-side foot forward), trunk ~10 deg forward; D-handle at chest height. The arm
// reaches towards the pulley with the shoulder protracted and a few degrees of trunk rotation, then the scapula sets
// back and the elbow drives the handle to the hip.

const FACE_PULLEY_Y = 1.6
const ONE_PULLEY_Y = 1.25
const CABLE_KG = { face: 10, one: 15 }
/** rope: carabiner to the middle of the fist, m */
const STRAND = 0.36
export const ROPE_END = { r: 0.012, grip: 0.05, stopper: 0.035, stopperR: 0.021 }
/** strand collision part: from the ferrule towards the fist, stopping short of the hand that closes on it, m */
const STRAND_PART = STRAND - 0.1
/** ferrule bottom below the carabiner (the rope attachment's cap), attachment frame */
const FERRULE: V3 = [0, -0.02, 0]

export type StandingCable = {
  kind: 'cable'
  tempo: Tempo
  setup: Setup
  variant: 'face' | 'one'
  work: Side
  pulley: V3
  handle: ImplementSpec
  stance?: StanceSetup
  feet?: FootTarget[]
  hip?: { pos: V3; tilt: number }
  /** single-arm: grip start (protracted, trunk turned) and finish, world */
  start?: V3
  finish?: V3
  sh0?: V3
  sway?: Sway
}

const cyl = (a: V3, b: V3, r: number, pad = false): Part => ({ shape: 'cylinder', a, b, r, ...(pad ? { pad } : {}) })

/** column behind the pulley, facing the lifter (compose.ts draws the cable stack from it) */
function stackSpec(pulley: V3): ImplementSpec {
  const col: V3 = [pulley[0], 0, pulley[2] + 0.12]
  return { id: 'stack', kind: 'bench', mass: 0, com: [0, 0, 0], parts: [cyl(col, [col[0], 2.1, col[2]], 0.05), cyl(pulley, [pulley[0], pulley[1], col[2]], 0.04)], sites: {} }
}

/** rope end held in the fist: the rope through the fist along the grip axis, stopper under the little finger */
export function ropeEnd(id: string): ImplementSpec {
  const { r, grip, stopper, stopperR } = ROPE_END
  return {
    id,
    kind: 'row_rope_end',
    mass: 0.2,
    com: [0, 0, 0],
    parts: [cyl([-grip, 0, 0], [grip, 0, 0], r), cyl([-grip - stopper, 0, 0], [-grip, 0, 0], stopperR)],
    sites: { h: { pos: [0, 0, 0], axis: [1, 0, 0] }, in: { pos: [grip, 0, 0] } },
  }
}

/** free strand from the ferrule towards a fist, along local -Y */
export function ropeStrand(id: string): ImplementSpec {
  return { id, kind: 'row_rope_strand', mass: 0, com: [0, 0, 0], parts: [cyl([0, 0, 0], [0, -STRAND_PART, 0], ROPE_END.r)], sites: {} }
}

// ---------- face pull ----------

type Key = { plane: number; elev: number; elbow: number; rot: number }
/**
 * arm keys by elbow-drive progress: forward reach, elbows out and back at shoulder height, external rotation last.
 * Each channel runs through its keys on a monotone cubic, so velocities stay continuous.
 */
const FACE_KEYS: [number, Key][] = [
  [0, { plane: 96, elev: 92, elbow: 10, rot: 0 }],
  [0.35, { plane: 60, elev: 90, elbow: 52, rot: -4 }],
  [0.7, { plane: 26, elev: 89, elbow: 100, rot: -22 }],
  [1, { plane: 8, elev: 82, elbow: 136, rot: -60 }],
]
const FACE_CURVES = (['plane', 'elev', 'elbow', 'rot'] as const).map((k) => [k, monotoneCubic(FACE_KEYS.map(([e]) => e), FACE_KEYS.map(([, v]) => v[k]))] as const)

function faceKey(e: number): Key {
  return Object.fromEntries(FACE_CURVES.map(([k, f]) => [k, f(e)])) as Key
}

function faceArms(skel: Skeleton, q: Float64Array, s: number, e: number) {
  const k = faceKey(e)
  for (const side of ['l', 'r'] as const) {
    const g = shoulderRhythm(k.elev, k.plane)
    setDofs(skel, q, {
      [`shoulder_${side}.plane`]: k.plane,
      [`shoulder_${side}.elev`]: k.elev,
      [`shoulder_${side}.rot`]: k.rot,
      [`elbow_${side}.flex`]: k.elbow,
      [`forearm_${side}.pro`]: 0,
      [`wrist_${side}.flex`]: lerp(0, -8, e),
      [`wrist_${side}.dev`]: 0,
      [`clavicle_${side}.prot`]: lerp(PROT.start, PROT.finish, s),
      [`clavicle_${side}.elev`]: g.elev * 0.6,
      [`scapula_${side}.uprot`]: g.uprot,
      [`grip_${side}.close`]: 1,
    })
  }
}

/** the rope knot where both strands meet, towards the pulley from the fists */
function knotPose(skel: Skeleton, q: Float64Array, pulley: V3, handle: ImplementSpec): ImplementPose {
  const f = fk(skel, q)
  const hl = handFrame(skel, f, 'l').pos, hr = handFrame(skel, f, 'r').pos
  const m = scale(add(hl, hr), 0.5)
  const u = norm(sub(pulley, m))
  const half = dist(hl, hr) / 2
  const k = add(m, scale(u, Math.sqrt(Math.max(0.0025, STRAND * STRAND - half * half))))
  const rot = qfromBasis([1, 0, 0], norm(sub(pulley, k)))
  return { id: handle.id, pos: k, rot }
}

function ropeEnds(skel: Skeleton, q: Float64Array, knot: ImplementPose): ImplementPose[] {
  const f = fk(skel, q)
  const from = add(knot.pos, qrot(knot.rot, FERRULE))
  return (['l', 'r'] as const).flatMap((s) => {
    const h = handFrame(skel, f, s)
    return [
      { id: `rope_${s}`, pos: h.pos, rot: implementFromHand(h.axis, h.palm) },
      { id: `strand_${s}`, pos: from, rot: qfromTo([0, -1, 0], norm(sub(h.pos, from))) },
    ]
  })
}

function faceTrunk(skel: Skeleton, q: Float64Array, s: number) {
  setDofs(skel, q, { 'lumbar.flex': -1, 'thorax.flex': lerp(2, -2, s), 'neck.flex': lerp(-2, 2, s), 'head.flex': 0 })
}

function faceContext(p: P, skel: Skeleton, tempo: Tempo): StandingCable {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  // the knot and ferrule where the strands meet (the stack draws them); the strands and rope ends are their own parts
  const handle: ImplementSpec = { ...cableHandle({ id: 'handle', attachment: 'rope' }), parts: [cyl([0, -0.045, 0], [0, 0.01, 0], 0.02)], sites: {} }
  // pulley straight ahead of the shoulders, far enough that the cable stays taut at full reach
  const q0 = zeroQ(skel)
  faceTrunk(skel, q0, 0)
  const f0 = fk(skel, q0)
  const sh = segPos(skel, f0, 'humerus_l')
  const pulley: V3 = [0, FACE_PULLEY_Y, sh[2] + 1.15]
  const cable = { pulley, implement: handle.id, point: [0, 0, 0] as V3, kg: CABLE_KG.face }
  const v: StandingCable = { kind: 'cable', tempo, setup: undefined as never, variant: 'face', work: 'r', pulley, handle, stance }
  v.setup = {
    implements: [handle, ropeEnd('rope_l'), ropeEnd('rope_r'), ropeStrand('strand_l'), ropeStrand('strand_r'), stackSpec(pulley)],
    contacts: [...plantedContacts(skel, stance), { site: 'grip_l', kind: 'grip', target: { implement: 'rope_l', grip: 'h' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'rope_r', grip: 'h' } }],
    tempo,
    symmetric: p.laterality === 'bilateral',
    balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL },
    cables: [cable],
  }
  v.sway = limitSway((u, sway) => faceFrame(skel, zeroQ(skel), v, u, sway).bal)
  return v
}

function faceFrame(skel: Skeleton, q: Float64Array, v: StandingCable, u: number, sway?: Sway) {
  const ph = phases(u, v.tempo)
  faceTrunk(skel, q, ph.s)
  const cable = v.setup.cables![0]
  const measure = (qq: Float64Array) => {
    const kp = knotPose(skel, qq, v.pulley, v.handle)
    const { at, force } = cableForce(cable, kp)
    return centerOfPressure(skel, fk(skel, qq), [{ mass: 0.9, pos: comWorld(v.handle, kp) }], [{ at, force }])[1]
  }
  const bal = standBalanced(skel, q, v.stance!, { knee: 8, tilt: 1 }, measure, (qq) => faceArms(skel, qq, ph.s, ph.e), undefined, sway)
  return { bal }
}

// ---------- single-arm ----------

function oneContext(p: P, skel: Skeleton, tempo: Tempo): StandingCable {
  const work = working(p)
  const free = other(work)
  const lat = (s: Side) => (s === 'l' ? 1 : -1)
  // split stance: free-side foot forward, working-side foot back, hip width apart
  const half = (skel.data.hipWidth + 0.03) / 2
  const feet = [plantFoot(skel, free, [lat(free) * half, 0, 0.24], 8), plantFoot(skel, work, [lat(work) * half, 0, -0.22], 16)]
  const handle = cableHandle({ id: 'handle', attachment: 'single_handle' })
  const v: StandingCable = { kind: 'cable', tempo, setup: undefined as never, variant: 'one', work, pulley: [0, 0, 0], handle, feet }
  // hips between the feet, dropped until the back knee is just soft (the front one bends more); trunk leans
  // torsoAngle forward
  const tilt = p.torsoAngle - 2
  const hipAt = (y: number): V3 => [0, y, 0.02]
  const backKnee = (y: number) => {
    const q = zeroQ(skel)
    oneBody(skel, q, v, { pos: hipAt(y), tilt }, 0)
    return q[skel.dof[`knee_${work}.flex`]]
  }
  v.hip = { pos: hipAt(root1d((y) => backKnee(y) - 6, 0.8, 1.0, { tol: 1e-6 }).x), tilt }
  const q0 = zeroQ(skel)
  oneBody(skel, q0, v, v.hip, 0)
  const sh = segPos(skel, fk(skel, q0), `humerus_${work}`)
  v.sh0 = sh
  // pulley at chest height in line with the working shoulder; the arm reaches along the cable
  v.pulley = [sh[0], ONE_PULLEY_Y, sh[2] + 1.05]
  const dir = norm(sub(v.pulley, sh))
  const elbowAt = (d: number) => {
    const q = Float64Array.from(q0)
    oneArm(skel, q, p, v, add(sh, scale(dir, d)))
    return q[skel.dof[`elbow_${work}.flex`]]
  }
  v.start = add(sh, scale(dir, root1d((d) => elbowAt(d) - 10, 0.4, 0.8, { tol: 1e-6 }).x))
  const q1 = zeroQ(skel)
  oneBody(skel, q1, v, v.hip, 1)
  v.finish = localToWorld(skel, fk(skel, q1), 'lumbar2', [lat(work) * 0.2, 0.02, 0.1])
  const contacts: Contact[] = [{ site: `grip_${work}`, kind: 'grip', target: { implement: handle.id, grip: 'c' } }]
  for (const ft of feet) for (const site of ['heel', 'ball']) contacts.push({ site: `${site}_${ft.side}`, kind: 'planted', target: { world: add(ft.ankle, qrot(ft.rot, skel.data.sites[`${site}_${ft.side}`].local)) } })
  v.setup = {
    implements: [handle, stackSpec(v.pulley)],
    contacts,
    tempo,
    symmetric: false,
    cables: [{ pulley: v.pulley, implement: handle.id, point: [0, 0, 0], kg: CABLE_KG.one }],
  }
  return v
}

function oneBody(skel: Skeleton, q: Float64Array, v: StandingCable, hip: { pos: V3; tilt: number }, s: number) {
  const work = v.work, free = other(work)
  const lat = work === 'l' ? 1 : -1
  setDofs(skel, q, {
    'lumbar.flex': 0,
    'thorax.flex': 2,
    // the working shoulder follows the cable forward at the stretch
    'thorax.rot': -lat * lerp(8, -2, s),
    'neck.flex': -4,
    'head.flex': -2,
    'neck.rot': lat * lerp(4, -1, s),
    [`clavicle_${work}.prot`]: lerp(PROT.start, PROT.finish, s),
    [`clavicle_${work}.elev`]: lerp(4, -3, s),
    [`shoulder_${free}.plane`]: 40,
    [`shoulder_${free}.elev`]: 12,
    [`elbow_${free}.flex`]: 18,
    [`grip_${free}.close`]: 0.3,
    [`grip_${work}.close`]: 1,
  })
  setScapula(skel, q, free)
  setPelvis(skel, q, hip.pos, hip.tilt)
  solveLegs(skel, q, v.feet!)
}

function oneArm(skel: Skeleton, q: Float64Array, p: P, v: StandingCable, target: V3) {
  const work = v.work
  const lat = work === 'l' ? 1 : -1
  // neutral, thumb up: the D-handle swivels on its carabiner, so it sits square to the cable in the fist
  const axis = norm(reject([0, 1, 0], norm(sub(v.pulley, target))))
  reach(skel, q, work, { pos: target, axis, palm: [-lat, 0, 0], oblique: -14 }, { pole: elbowPole(skel, q, work, p.elbowFlare * 0.6, 0.8), planeHint: 90, devBand: [-22, 20] })
}

/** D-handle across the palm, carabiner towards the pulley */
function dHandlePose(skel: Skeleton, q: Float64Array, v: StandingCable): ImplementPose {
  const h = handFrame(skel, fk(skel, q), v.work)
  const toward = norm(sub(v.pulley, h.pos))
  const rot = qfromBasis(h.axis, norm(cross(cross(h.axis, toward), h.axis)))
  return { id: v.handle.id, pos: sub(h.pos, qrot(rot, v.handle.sites.c.pos)), rot }
}

// ---------- entry ----------

export function cableContext(p: P, skel: Skeleton, tempo: Tempo): StandingCable {
  return p.finish === 'external_rotation' || p.attachment === 'rope' ? faceContext(p, skel, tempo) : oneContext(p, skel, tempo)
}

export function sampleCable(u: number, p: P, skel: Skeleton, v: StandingCable): Pose {
  const q = zeroQ(skel)
  if (v.variant === 'face') {
    faceFrame(skel, q, v, u, v.sway)
    const knot = knotPose(skel, q, v.pulley, v.handle)
    return { q, implements: [knot, ...ropeEnds(skel, q, knot), { id: 'stack', pos: [0, 0, 0], rot: qid() }], contacts: v.setup.contacts }
  }
  const ph = phases(u, v.tempo)
  oneBody(skel, q, v, v.hip!, ph.s)
  const sh = segPos(skel, fk(skel, q), `humerus_${v.work}`)
  const from = add(v.start!, sub(sh, v.sh0!))
  oneArm(skel, q, p, v, add(scale(from, 1 - ph.g), scale(v.finish!, ph.g)))
  return { q, implements: [dHandlePose(skel, q, v), { id: 'stack', pos: [0, 0, 0], rot: qid() }], contacts: v.setup.contacts }
}

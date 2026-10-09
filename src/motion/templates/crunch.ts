import { attachHand, type FootTarget } from '../constraints.ts'
import { bodyCapsules, type Capsule } from '../collide.ts'
import { fk, sitePos } from '../fk.ts'
import { siteWorld, type ImplementSpec } from '../implements.ts'
import { PLATE, weightPlate } from '../implements/free-weights.ts'
import { declineBoard, declineBoardFrame } from '../implements/core.ts'
import { floorMat } from '../implements/shared.ts'
import { dls } from '../ik.ts'
import { add, lerp, norm, qfromBasis, qid, qmul, qrot, scale, smoothstep, type Quat, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { ghdSitContext, sampleGhdSit, type GhdSit } from './core/ghd-sit-up.ts'
import { kneelContext, sampleKneel, type Kneel } from './core/kneel-crunch.ts'
import { sampleStandCrunch, standCrunchContext, type StandCrunch } from './core/stand-crunch.ts'
import { legsToward, MAT_TOP, matClearance, mirrorArm, plantFeet, restHead, restOnMat, segPosOf, SINK, toWorld } from './core/floor.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { setPelvis } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Crunch: spinal flexion from the thorax, the pelvis stays down. Floor crunch (805): supine on a mat, knees bent at
// the param, feet planted; the shoulder blades curl off the mat with the thorax leading (research motion-authoring:
// trunk flexion thoracolumbar 0 -> ~30 deg), a small posterior pelvic tilt, a fist of space between chin and chest,
// fingertips at the temples with the elbows out. Kneeling cable crunch (801): core/kneel-crunch.ts. Weighted crunch
// (834): the floor crunch with a plate held on the chest by its rim. Sit-up (838): the curl, then the trunk rises from the
// hips with the feet planted, arms folded across the chest; decline sit-up (818): the same on a decline board, feet
// under its rollers (the floor solution moved rigidly onto the pad). Standing cable crunch (840): core/stand-crunch.ts.
// GHD sit-up (817, implement machine, seated): core/ghd-sit-up.ts.

type P = ParamsOf<'crunch'>

/** floor crunch, deg: thoracic and lumbar flexion bottom -> top, posterior pelvic tilt at the top, neck and head at the top */
export const FLOOR = { thorax: [0, 22], lumbar: [2, 9], tilt: 4, neck: 16, head: 2 } as const
/** neck extension limit lying down, deg: past it the head stays just off the mat */
const NECK_MIN = -8
/** feet planted this far either side of the midline, m */
const FEET_HALF = 0.112
/**
 * decline board: the hips this far up the pad from its head end, the rollers' axis this far past the ankle joints up the
 * slope and off the pad (resting on the front of the ankles), m; how far the soles and the rollers press into the foam,
 * mm (the pad tolerance)
 */
const BOARD = { hips: 1.0, roller: [0.07, 0.06], footSink: 15 } as const
/**
 * the plate's back face resting on the chest, and the fingers wrapping the rim over its faces (the hand capsule reaches
 * past the rim onto the core disc), mm (a lead decision)
 */
const PLATE_REST = 22

type Floor = {
  kind: 'floor'
  tempo: Tempo
  setup: Setup
  /** sit-up: the trunk rises from the hips; arms crossed on the chest, or a plate held on it */
  sitUp: boolean
  arms: 'temples' | 'crossed' | 'plate'
  plate?: ImplementSpec
  feet: FootTarget[]
  /** pelvis tilt resting at the bottom, deg */
  tilt0: number
  /** neck flexion with the head resting on the mat at the bottom, deg */
  neck0: number
  hipZ: number
  mat: ImplementPose
  /** decline board: the rigid move from the floor solution onto the pad (rotation about X by -a, the floor point under
   * the hips to the pad), the board */
  board?: { spec: ImplementSpec; a: number; rot: Quat; at: V3 }
}

type Ctx = Floor | Kneel | StandCrunch | GhdSit

const PELVIS = (c: Capsule) => c.segment === 'pelvis' || c.segment === 'lumbar1'
const UPPER_BACK = (c: Capsule) => c.segment === 'thorax1' || c.segment === 'thorax2'

function spine(skel: Skeleton, q: Float64Array, c: number) {
  setDofs(skel, q, { 'thorax.flex': lerp(FLOOR.thorax[0], FLOOR.thorax[1], c), 'lumbar.flex': lerp(FLOOR.lumbar[0], FLOOR.lumbar[1], c), 'grip_*.close': 0 })
}

/** left fingertips at the temple: the index edge of the hand against the head, palm towards the face side, fingers up */
export function templeHand(skel: Skeleton, q: Float64Array) {
  const f = fk(skel, q)
  const head = f.rot[skel.seg.head]
  // hand axes in the head frame: palm (-X local) faces forward, fingers (-Y local) point up and a little back
  const fingers = norm([0.1, 1, -0.35])
  const hand = qmul(head, qfromBasis([0, 0, -1], scale(fingers, -1)))
  const target = toWorld(skel, f, 'head', TEMPLE)
  setDofs(skel, q, { 'clavicle_*.prot': 2, 'clavicle_*.elev': 6 })
  const thorax = f.rot[skel.seg.thorax2]
  attachHand(skel, q, 'l', { pos: target, axis: qrot(hand, [0, 0, 1]), palm: qrot(hand, [-1, 0, 0]), hand }, { pole: qrot(thorax, [1, 0.25, -0.25]), planeHint: 30 })
  mirrorArm(skel, q)
}

/** grip site of the left hand at the temple, head frame, m */
const TEMPLE: V3 = [0.118, 0.035, 0.005]

function floorFrame(skel: Skeleton, ctx: Floor, c: number): Float64Array {
  const q = zeroQ(skel)
  if (ctx.sitUp) sitUpBody(skel, q, ctx, c)
  else {
    spine(skel, q, c)
    setPelvis(skel, q, [0, 0.3, ctx.hipZ], ctx.tilt0 - FLOOR.tilt * c)
  }
  restOnMat(skel, q, PELVIS)
  legsToward(skel, q, ctx.feet, [0, 1, 0])
  const neck = ctx.sitUp ? smoothstep(Math.min(1, c / SIT_UP.curl)) : c
  setDofs(skel, q, { 'neck.flex': lerp(ctx.neck0, FLOOR.neck, neck), 'head.flex': lerp(ctx.neck0 * 0.3, FLOOR.head, neck) })
  if (ctx.arms === 'temples') templeHand(skel, q)
  else if (ctx.arms === 'crossed') crossedArms(skel, q)
  else plateArms(skel, q, ctx.plate!)
  if (ctx.board) onBoard(skel, q, ctx.board)
  return q
}

/** the floor solution moved rigidly onto the decline pad: only the root changes (every other angle is relative) */
function onBoard(skel: Skeleton, q: Float64Array, b: NonNullable<Floor['board']>) {
  const d = skel.dof
  const p = add(qrot(b.rot, [q[d['pelvis.tx']], q[d['pelvis.ty']] - MAT_TOP, q[d['pelvis.tz']]]), b.at)
  q[d['pelvis.tx']] = p[0]
  q[d['pelvis.ty']] = p[1]
  q[d['pelvis.tz']] = p[2]
  q[d['pelvis.tilt']] -= b.a
}

const boardPoint = (b: NonNullable<Floor['board']>, p: V3): V3 => add(qrot(b.rot, [p[0], p[1] - MAT_TOP, p[2]]), b.at)

/**
 * Sit-up: the spine curls first (the crunch's thoracic and lumbar flexion, over the first SIT_UP.curl of the rise),
 * then the pelvis rolls up off its back onto the seat and the hips flex until the chest nears the thighs; the feet
 * stay planted (anchored). Research (motion-authoring): trunk flexion thoracolumbar, then hip flexion; the top
 * angles are author judgment.
 */
export const SIT_UP = { curl: 0.45, thorax: 24, lumbar: 18, tilt: -66 } as const

function sitUpBody(skel: Skeleton, q: Float64Array, ctx: Floor, c: number) {
  const curl = smoothstep(Math.min(1, c / SIT_UP.curl))
  const rise = smoothstep(Math.max(0, (c - 0.15) / 0.85))
  setDofs(skel, q, { 'thorax.flex': lerp(FLOOR.thorax[0], SIT_UP.thorax, curl), 'lumbar.flex': lerp(FLOOR.lumbar[0], SIT_UP.lumbar, curl), 'grip_*.close': 0 })
  setPelvis(skel, q, [0, 0.3, ctx.hipZ], lerp(ctx.tilt0, SIT_UP.tilt, rise))
}

/**
 * arms folded across the chest: each hand on the opposite side of the chest, the forearms one above the other (the
 * left higher, nearer the collarbones), so they never cross through each other; grip sites from the sternum in the
 * thorax frame (towards the hand's own side, the head, out of the chest), m. The sit-up stops with the trunk ~25 deg
 * short of upright, where the lower forearm comes to the thighs.
 */
const CROSSED = { l: [-0.11, 0.11, 0.09] as V3, r: [-0.11, -0.07, 0.1] as V3 }

function crossedArms(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'clavicle_*.prot': 6, 'clavicle_*.elev': 2 })
  for (const side of ['l', 'r'] as const) {
    const f = fk(skel, q)
    const thorax = f.rot[skel.seg.thorax2]
    const s = side === 'l' ? 1 : -1
    const o = CROSSED[side]
    const target = add(sitePos(skel, f, 'sternum'), qrot(thorax, [s * o[0], o[1], o[2]]))
    attachHand(skel, q, side, { pos: target, axis: qrot(thorax, [0, 1, 0]), palm: qrot(thorax, [0, 0, -1]) }, { pole: qrot(thorax, [s * 0.8, -0.5, 0.3]), planeHint: 90 })
  }
}

/** a plate held flat on the chest by its rim at 3 and 9 o'clock, the back face resting on the sternum */
const PLATE_KG = 10
/** plate centre from the sternum site along the thorax frame (up towards the head, out of the chest), m */
const PLATE_AT: V3 = [0, -0.02, PLATE[PLATE_KG].w / 2 + 0.035]

function platePose(skel: Skeleton, f: ReturnType<typeof fk>, plate: ImplementSpec): ImplementPose {
  const thorax = f.rot[skel.seg.thorax2]
  return { id: plate.id, pos: add(sitePos(skel, f, 'sternum'), qrot(thorax, PLATE_AT)), rot: thorax }
}

function plateArms(skel: Skeleton, q: Float64Array, plate: ImplementSpec) {
  setDofs(skel, q, { 'clavicle_*.prot': 8, 'clavicle_*.elev': 2, 'grip_*.close': 1 })
  const f = fk(skel, q)
  const pose = platePose(skel, f, plate)
  const thorax = f.rot[skel.seg.thorax2]
  const g = siteWorld(plate, pose, 'rim_l')
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: qrot(thorax, [-1, 0, 0]) }, { pole: qrot(thorax, [1, -0.6, -0.2]), planeHint: 60 })
  mirrorArm(skel, q)
}

function floorContext(p: P, skel: Skeleton, tempo: Tempo): Floor {
  const sitUp = p.range === 'sit_up'
  const arms = p.implement === 'plate' ? 'plate' : (p.arms ?? 'temples')
  const hipZ = 0
  const q = zeroQ(skel)
  spine(skel, q, 0)
  // lying: pelvis and upper back both on the mat
  const res = (x: number[]) => {
    setPelvis(skel, q, [0, x[0], hipZ], x[1])
    const caps = bodyCapsules(skel, fk(skel, q))
    return [(matClearance(caps.filter(PELVIS)) + SINK) * 100, (matClearance(caps.filter(UPPER_BACK)) + SINK) * 100]
  }
  const r = dls(res, [0.12, -90], { tol: 1e-8, iters: 60 })
  const tilt0 = r.x[1]
  setPelvis(skel, q, [0, r.x[0], hipZ], tilt0)
  const neck0 = Math.max(NECK_MIN, restHead(skel, q))
  const { feet, contacts } = plantFeet(skel, q, hipZ, p.kneeAngle, FEET_HALF, 0)
  const f = fk(skel, q)
  const headZ = segPosOf(skel, f, 'head')[2]
  const toeZ = feet[0].ankle[2] + 0.25
  const matSpec: ImplementSpec = floorMat()
  const mat: ImplementPose = { id: matSpec.id, pos: [0, 0, (headZ - 0.2 + toeZ) / 2], rot: qid() }
  if (p.benchAngle !== undefined) {
    // decline: the floor sit-up on the pad, the hips placed so the rollers lie over the front of the ankles
    const fr = declineBoardFrame(p.benchAngle)
    const ankle = feet[0].ankle
    const along = BOARD.hips + ankle[2] + BOARD.roller[0]
    const spec = declineBoard({ id: 'board', angle: p.benchAngle, roller: { along, lift: ankle[1] - MAT_TOP + BOARD.roller[1] } })
    const board = { spec, a: (fr.a * 180) / Math.PI, rot: fr.rot, at: fr.top(BOARD.hips) }
    const moved: Contact[] = contacts.map((c) => ('world' in c.target ? { ...c, target: { world: boardPoint(board, c.target.world) } } : c))
    const setup: Setup = { implements: [spec], contacts: moved, tempo, symmetric: arms !== 'crossed', rests: [{ implement: spec.id, regions: ['foot_l', 'foot_r'], tol: BOARD.footSink }] }
    return { kind: 'floor', tempo, setup, sitUp, arms, feet, tilt0, neck0, hipZ, mat, board }
  }
  if (arms === 'plate') {
    const plate = weightPlate({ id: 'plate', kg: PLATE_KG })
    const grips: Contact[] = [
      { site: 'grip_l', kind: 'grip', target: { implement: plate.id, grip: 'rim_l' } },
      { site: 'grip_r', kind: 'grip', target: { implement: plate.id, grip: 'rim_r' } },
    ]
    const setup: Setup = { implements: [matSpec, plate], contacts: [...contacts, ...grips], tempo, symmetric: true, rests: [{ implement: plate.id, regions: ['trunk', 'hand_l', 'hand_r'], tol: PLATE_REST }] }
    return { kind: 'floor', tempo, setup, sitUp, arms, plate, feet, tilt0, neck0, hipZ, mat }
  }
  // crossed arms are not mirror images (one forearm lies over the other)
  const setup: Setup = { implements: [matSpec], contacts, tempo, symmetric: arms !== 'crossed' }
  return { kind: 'floor', tempo, setup, sitUp, arms, feet, tilt0, neck0, hipZ, mat }
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if ((p.implement === 'bodyweight' || p.implement === 'plate') && p.posture === 'lying_supine' && (p.benchAngle === undefined || (p.range === 'sit_up' && p.implement === 'bodyweight'))) return floorContext(p, skel, tempo)
  if (p.implement === 'cable' && p.posture === 'kneeling' && p.attachment === 'rope') return kneelContext(skel, tempo)
  if (p.implement === 'cable' && p.posture === 'standing' && p.attachment === 'rope') return standCrunchContext(skel, tempo)
  if (p.implement === 'machine' && p.posture === 'seated') return ghdSitContext(skel, tempo)
  throw new Error(`crunch: variant not implemented yet (${p.implement}/${p.posture}/${p.attachment ?? '-'})`)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  if (ctx.kind === 'kneel') return sampleKneel(skel, ctx, c)
  if (ctx.kind === 'stand') return sampleStandCrunch(skel, ctx, c)
  if (ctx.kind === 'ghd') return sampleGhdSit(skel, ctx, c)
  const q = floorFrame(skel, ctx, c)
  if (ctx.board) return { q, implements: [{ id: ctx.board.spec.id, pos: [0, 0, 0], rot: qid() }], contacts: ctx.setup.contacts }
  const held = ctx.plate ? [platePose(skel, fk(skel, q), ctx.plate)] : []
  return { q, implements: [ctx.mat, ...held], contacts: ctx.setup.contacts }
}

export const crunch: Template<P> = {
  id: 'crunch',
  driver: 'root',
  params: SCHEMAS.crunch,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}

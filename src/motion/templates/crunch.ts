import { attachHand, type FootTarget } from '../constraints.ts'
import { bodyCapsules, type Capsule } from '../collide.ts'
import { fk } from '../fk.ts'
import type { ImplementSpec } from '../implements.ts'
import { floorMat } from '../implements/shared.ts'
import { dls } from '../ik.ts'
import { lerp, norm, qfromBasis, qid, qmul, qrot, scale, type V3 } from '../math.ts'
import { setDofs, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { kneelContext, sampleKneel, type Kneel } from './core/kneel-crunch.ts'
import { legsToward, matClearance, mirrorArm, plantFeet, restHead, restOnMat, segPosOf, SINK, toWorld } from './core/floor.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { setPelvis } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Crunch: spinal flexion from the thorax, the pelvis stays down. Floor crunch (805): supine on a mat, knees bent at
// the param, feet planted; the shoulder blades curl off the mat with the thorax leading (research motion-authoring:
// trunk flexion thoracolumbar 0 -> ~30 deg), a small posterior pelvic tilt, a fist of space between chin and chest,
// fingertips at the temples with the elbows out. Kneeling cable crunch (801): core/kneel-crunch.ts.

type P = ParamsOf<'crunch'>

/** floor crunch, deg: thoracic and lumbar flexion bottom -> top, posterior pelvic tilt at the top, neck and head at the top */
export const FLOOR = { thorax: [0, 22], lumbar: [2, 9], tilt: 4, neck: 16, head: 2 } as const
/** neck extension limit lying down, deg: past it the head stays just off the mat */
const NECK_MIN = -8
/** feet planted this far either side of the midline, m */
const FEET_HALF = 0.112

type Floor = {
  kind: 'floor'
  tempo: Tempo
  setup: Setup
  feet: FootTarget[]
  /** pelvis tilt resting at the bottom, deg */
  tilt0: number
  /** neck flexion with the head resting on the mat at the bottom, deg */
  neck0: number
  hipZ: number
  mat: ImplementPose
}

type Ctx = Floor | Kneel

const PELVIS = (c: Capsule) => c.segment === 'pelvis' || c.segment === 'lumbar1'
const UPPER_BACK = (c: Capsule) => c.segment === 'thorax1' || c.segment === 'thorax2'

function spine(skel: Skeleton, q: Float64Array, c: number) {
  setDofs(skel, q, { 'thorax.flex': lerp(FLOOR.thorax[0], FLOOR.thorax[1], c), 'lumbar.flex': lerp(FLOOR.lumbar[0], FLOOR.lumbar[1], c), 'grip_*.close': 0 })
}

/** left fingertips at the temple: the index edge of the hand against the head, palm towards the face side, fingers up */
function templeHand(skel: Skeleton, q: Float64Array) {
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
  spine(skel, q, c)
  setPelvis(skel, q, [0, 0.3, ctx.hipZ], ctx.tilt0 - FLOOR.tilt * c)
  restOnMat(skel, q, PELVIS)
  legsToward(skel, q, ctx.feet, [0, 1, 0])
  setDofs(skel, q, { 'neck.flex': lerp(ctx.neck0, FLOOR.neck, c), 'head.flex': lerp(ctx.neck0 * 0.3, FLOOR.head, c) })
  templeHand(skel, q)
  return q
}

function floorContext(p: P, skel: Skeleton, tempo: Tempo): Floor {
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
  const setup: Setup = { implements: [matSpec], contacts, tempo, symmetric: true }
  return { kind: 'floor', tempo, setup, feet, tilt0, neck0, hipZ, mat }
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.implement === 'bodyweight' && p.posture === 'lying_supine') return floorContext(p, skel, tempo)
  if (p.implement === 'cable' && p.posture === 'kneeling' && p.attachment === 'rope') return kneelContext(skel, tempo)
  throw new Error(`crunch: variant not implemented yet (${p.implement}/${p.posture}/${p.attachment ?? '-'})`)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  if (ctx.kind === 'kneel') return sampleKneel(skel, ctx, c)
  return { q: floorFrame(skel, ctx, c), implements: [ctx.mat], contacts: ctx.setup.contacts }
}

export const crunch: Template<P> = {
  id: 'crunch',
  driver: 'root',
  params: SCHEMAS.crunch,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}

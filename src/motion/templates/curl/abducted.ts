import { fk, segPos } from '../../fk.ts'
import { lerp, type V3 } from '../../math.ts'
import { setDofs, setScapula, zeroQ, type Pose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { crossoverBody, crossoverContext, crossoverSway, handlePoses, type CrossoverCtx } from '../crossover.ts'
import type { ParamsOf } from '../schemas.ts'
import { stand, makeStance, stanceWidth } from '../standing.ts'

// High cable curl (729): standing between the two stacks of a cable crossover with both pulleys at shoulder height,
// a D-handle in each hand. The upper arms stay level, straight out to the sides (shoulder abducted ~90 deg and turned
// out, so the elbows bend upwards), and the elbows run from nearly straight to ~125 deg, bringing the hands beside the
// ears (the double-biceps pose). The two pulls cancel sideways; the body leans against what is left over.

type P = ParamsOf<'curl'>

const HIGH = {
  /** pulleys this far out either side, m: a little wider than the F3 crossover, so the straight arms' hands stay clear of the pulley carriages */
  x: 1.2,
  /** pulleys this far ahead of the midfoot line, m: in line with the straight arms, so the pulls barely tip the lifter */
  z: -0.04,
  kg: 8,
  knee: 6,
  tilt: 2,
  /** upper arm: elevation, plane (0 = straight out to the side) and humeral external rotation (elbows bend upwards), deg */
  elev: 88,
  plane: 0,
  rot: -88,
  elbow: [10, 125] as const,
  pro: -60,
  trunk: { 'lumbar.flex': -1, 'thorax.flex': 1, 'neck.flex': -3, 'head.flex': 0 },
}

export type Abducted = { ctx: CrossoverCtx; zero: () => Float64Array }

function arms(skel: Skeleton, q: Float64Array, c: number) {
  setDofs(skel, q, {
    'shoulder_*.plane': HIGH.plane,
    'shoulder_*.elev': HIGH.elev,
    'shoulder_*.rot': HIGH.rot,
    'elbow_*.flex': lerp(HIGH.elbow[0], HIGH.elbow[1], c),
    'forearm_*.pro': HIGH.pro,
    'wrist_*.flex': 0,
    'grip_*.close': 1,
  })
  setScapula(skel, q, 'l')
  setScapula(skel, q, 'r')
}

export function abductedContext(_p: P, skel: Skeleton, tempo: Tempo): Abducted {
  // pulleys level with the shoulder joints of the standing lifter
  const q0 = zeroQ(skel)
  setDofs(skel, q0, HIGH.trunk)
  stand(skel, q0, makeStance(skel, stanceWidth(skel, 'hip'), 10), { knee: HIGH.knee, df: 0, tilt: HIGH.tilt })
  arms(skel, q0, 0)
  const y = segPos(skel, fk(skel, q0), 'humerus_l')[1]
  const pulleys: { l: V3; r: V3 } = { l: [HIGH.x, y, HIGH.z], r: [-HIGH.x, y, HIGH.z] }
  const ctx = crossoverContext(skel, { tempo, pulleys, crossed: false, kg: HIGH.kg, stance: { kind: 'hip', knee: HIGH.knee, tilt: HIGH.tilt }, trunk: HIGH.trunk, facing: [0, 0, 1] })
  const zero = () => zeroQ(skel)
  // the ankles hold still: the arms' swing moves the centre of pressure inside the feet, not the body
  ctx.sway = { ref: crossoverSway(skel, ctx, zero, (u) => (q) => arms(skel, q, phaseAt(u, tempo).c)).ref, follow: 0 }
  return { ctx, zero }
}

export function sampleAbducted(u: number, skel: Skeleton, v: Abducted): Pose {
  const q = v.zero()
  const c = phaseAt(u, v.ctx.tempo).c
  crossoverBody(skel, v.ctx, q, (qq) => arms(skel, qq, c), v.ctx.sway)
  return { q, implements: [...handlePoses(skel, v.ctx, q), { id: v.ctx.crossover.id, pos: [0, 0, 0], rot: [0, 0, 0, 1] }], contacts: v.ctx.setup.contacts }
}

import { bodyCapsules, type Capsule } from '../../collide.ts'
import { fk } from '../../fk.ts'
import { floorMat } from '../../implements/shared.ts'
import { dls } from '../../ik.ts'
import { lerp, qid } from '../../math.ts'
import { setDofs, setScapula, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { matClearance, restOnMat, segPosOf, SINK } from './floor.ts'

// Hollow body hold (815) as a breathing hold: supine on the mat, the lower back pressed down (posterior pelvic tilt,
// the lumbar spine flat), the shoulder blades curled off the mat (thoracic flexion as at the top of a crunch), straight
// legs together a little off the mat, and the arms reaching overhead past the ears. Only the low back and pelvis rest
// on the mat. The breath (core/plank.ts): the slow eccentric inhales (ribs and legs settle a degree or two), the quick
// concentric exhales and braces. Research (motion-authoring): anti-extension holds keep the spine still; the angles are
// author judgment.

/** deg, inhaled -> braced: thoracic flexion (shoulders off the mat), lumbar flexion with the posterior tilt (the low
 * back flat on the mat, the trunk curled up from it), legs' angle above the mat */
export const HOLLOW = { thorax: [26, 30], lumbar: 14, tilt: 12, legs: [15, 17], neck: 14, arms: 170, knee: 3, ankle: -40 } as const

const LOW_BACK = (c: Capsule) => c.segment === 'pelvis' || c.segment === 'lumbar1' || c.segment === 'lumbar2'
const UPPER_BACK = (c: Capsule) => c.segment === 'thorax1' || c.segment === 'thorax2'
const PELVIS = (c: Capsule) => c.segment === 'pelvis' || c.segment === 'lumbar1'

export type Hollow = { kind: 'hollow'; tempo: Tempo; setup: Setup; tilt0: number; mat: ImplementPose }

function body(skel: Skeleton, q: Float64Array, v: Pick<Hollow, 'tilt0'>, c: number) {
  const tilt = v.tilt0 - HOLLOW.tilt
  setDofs(skel, q, {
    'lumbar.flex': HOLLOW.lumbar,
    'thorax.flex': lerp(HOLLOW.thorax[0], HOLLOW.thorax[1], c),
    'neck.flex': HOLLOW.neck,
    'head.flex': 2,
    // thigh elevation above the mat = hip flexion + the pelvis's turn from upright (tilt is about -90 lying)
    'hip_*.flex': lerp(HOLLOW.legs[0], HOLLOW.legs[1], c) + 90 + tilt,
    'hip_*.abd': 0,
    'knee_*.flex': HOLLOW.knee,
    'ankle_*.df': HOLLOW.ankle,
    // arms overhead past the ears in the flexion plane, palms facing in, elbows nearly straight
    'shoulder_*.plane': 90,
    'shoulder_*.elev': HOLLOW.arms,
    'shoulder_*.rot': 0,
    'elbow_*.flex': 6,
    'forearm_*.pro': 10,
    'grip_*.close': 0,
  })
  for (const s of ['l', 'r'] as const) setScapula(skel, q, s)
  setPelvis(skel, q, [0, 0.3, 0], tilt)
  restOnMat(skel, q, LOW_BACK)
}

export function hollowContext(skel: Skeleton, tempo: Tempo): Hollow {
  // lying flat: the pelvis tilt that rests both the pelvis and the upper back on the mat (as the floor crunch)
  const q = zeroQ(skel)
  const res = (x: number[]) => {
    setPelvis(skel, q, [0, x[0], 0], x[1])
    const caps = bodyCapsules(skel, fk(skel, q))
    return [(matClearance(caps.filter(PELVIS)) + SINK) * 100, (matClearance(caps.filter(UPPER_BACK)) + SINK) * 100]
  }
  const tilt0 = dls(res, [0.12, -90], { tol: 1e-8, iters: 60 }).x[1]
  const v = { tilt0 }
  const qb = zeroQ(skel)
  body(skel, qb, v, 1)
  const f = fk(skel, qb)
  // the mat under the back and hips (the hands and feet are in the air past its ends)
  const head = segPosOf(skel, f, 'head')[2], knee = segPosOf(skel, f, 'tibia_l')[2]
  const matSpec = floorMat()
  const mat: ImplementPose = { id: matSpec.id, pos: [0, 0, (head + knee) / 2], rot: qid() }
  const setup: Setup = { implements: [matSpec], contacts: [], tempo, symmetric: true }
  return { kind: 'hollow', tempo, setup, tilt0, mat }
}

export function sampleHollow(skel: Skeleton, v: Hollow, c: number): Pose {
  const q = zeroQ(skel)
  body(skel, q, v, c)
  return { q, implements: [v.mat], contacts: v.setup.contacts }
}

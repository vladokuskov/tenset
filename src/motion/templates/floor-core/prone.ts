import type { Capsule } from '../../collide.ts'
import { lerp } from '../../math.ts'
import { setDofs, setScapula, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { restOnMat } from '../core/floor.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { matUnder } from './common.ts'

// Superman hold (842) as a breathing hold: prone on the mat (head towards +Z), the glutes squeezed so the straight legs
// lift (hip extension), the chest and the arms reaching forward off the mat (lumbar and thoracic extension), the neck
// long with the eyes on the floor. Only the belly and the front of the pelvis rest on the mat. The breath (as the
// hollow hold): the slow eccentric inhales and settles a degree or two, the quick concentric exhales and lifts.
// Research (motion-authoring): spinal extension holds; lumbar extension ~15-20 deg, hip extension ~10-15 deg; the
// angles are author judgment.

/** deg, settled -> lifted: lumbar and thoracic extension (negative flexion), hip extension, shoulder elevation in the
 * flexion plane (arms reaching past the head, raised with the chest), neck */
export const SUPERMAN = { lumbar: [-13, -16], thorax: [-8, -10], hip: [-11, -14], arms: 168, neck: -4, knee: 3, ankle: -42 } as const

export type Prone = { kind: 'prone'; tempo: Tempo; setup: Setup; mat: ImplementPose }

const BELLY = (c: Capsule) => c.segment === 'pelvis' || c.segment === 'lumbar1' || c.segment === 'lumbar2' || c.segment === 'lumbar3'

function body(skel: Skeleton, q: Float64Array, c: number) {
  setDofs(skel, q, {
    'lumbar.flex': lerp(SUPERMAN.lumbar[0], SUPERMAN.lumbar[1], c),
    'thorax.flex': lerp(SUPERMAN.thorax[0], SUPERMAN.thorax[1], c),
    'neck.flex': SUPERMAN.neck,
    'head.flex': 0,
    'clavicle_*.elev': 6,
    'clavicle_*.prot': 0,
    'shoulder_*.plane': 90,
    'shoulder_*.elev': SUPERMAN.arms,
    'shoulder_*.rot': 0,
    'elbow_*.flex': 4,
    'forearm_*.pro': 70,
    'hip_*.flex': lerp(SUPERMAN.hip[0], SUPERMAN.hip[1], c),
    'hip_*.abd': 2,
    'knee_*.flex': SUPERMAN.knee,
    'ankle_*.df': SUPERMAN.ankle,
    'grip_*.close': 0,
  })
  for (const s of ['l', 'r'] as const) setScapula(skel, q, s)
  // face down: the pelvis's top towards +Z
  setPelvis(skel, q, [0, 0.3, 0], 90)
  restOnMat(skel, q, BELLY)
}

export function proneContext(skel: Skeleton, tempo: Tempo): Prone {
  const q = zeroQ(skel)
  body(skel, q, 0.5)
  const mat = matUnder(skel, [q], 0.15)
  return { kind: 'prone', tempo, setup: { implements: [mat.spec], contacts: [], tempo, symmetric: true }, mat: mat.pose }
}

export function sampleProne(skel: Skeleton, v: Prone, c: number): Pose {
  const q = zeroQ(skel)
  body(skel, q, c)
  return { q, implements: [v.mat], contacts: v.setup.contacts }
}

import { bodyCapsules, type Capsule } from '../../collide.ts'
import { fk } from '../../fk.ts'
import { floorMat } from '../../implements/shared.ts'
import { dls } from '../../ik.ts'
import { qid } from '../../math.ts'
import { setDofs, zeroQ, type ImplementPose, type Skeleton } from '../../skeleton.ts'
import { matClearance, SINK } from '../core/floor.ts'
import { setPelvis } from '../standing.ts'
import type { ImplementSpec } from '../../implements.ts'

// Shared by the floor-core kinds: the supine pelvis tilt that rests the hips and the upper back on the mat, and a mat
// laid under whatever the body covers.

export const PELVIS = (c: Capsule) => c.segment === 'pelvis' || c.segment === 'lumbar1'
export const LOW_BACK = (c: Capsule) => c.segment === 'pelvis' || c.segment === 'lumbar1' || c.segment === 'lumbar2'
export const UPPER_BACK = (c: Capsule) => c.segment === 'thorax1' || c.segment === 'thorax2'
export const LYING = (c: Capsule) => PELVIS(c) || UPPER_BACK(c)
export const TRUNK = (c: Capsule) => c.region === 'trunk'

/** supine with this lumbar flexion: the pelvis tilt (about -90) that rests both the pelvis and the upper back on the mat */
export function lyingTilt(skel: Skeleton, lumbar = 0): number {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': lumbar })
  const res = (x: number[]) => {
    setPelvis(skel, q, [0, x[0], 0], x[1])
    const caps = bodyCapsules(skel, fk(skel, q))
    return [(matClearance(caps.filter(PELVIS)) + SINK) * 100, (matClearance(caps.filter(UPPER_BACK)) + SINK) * 100]
  }
  return dls(res, [0.12, -90], { tol: 1e-8, iters: 60 }).x[1]
}

/** a mat under the body over the given poses: from `pad` m past the furthest capsule at each end, or the default length
 * centred on the body when that is longer */
export function matUnder(skel: Skeleton, qs: Float64Array[], pad = 0.08, length?: number): { spec: ImplementSpec; pose: ImplementPose } {
  let lo = Infinity, hi = -Infinity
  for (const q of qs) for (const c of bodyCapsules(skel, fk(skel, q))) {
    // only what lies low counts: limbs in the air past the mat's ends are fine
    if (Math.min(c.a[1], c.b[1]) - c.r > 0.15) continue
    lo = Math.min(lo, c.a[2] - c.r, c.b[2] - c.r)
    hi = Math.max(hi, c.a[2] + c.r, c.b[2] + c.r)
  }
  const L = Math.max(length ?? 0, hi - lo + 2 * pad)
  const spec = floorMat({ length: Math.min(2.2, Math.max(1.0, L)) })
  return { spec, pose: { id: spec.id, pos: [0, 0, (lo + hi) / 2], rot: qid() } }
}

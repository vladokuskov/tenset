import { fk } from '../../fk.ts'
import { DEG, dot, norm, qalign, qaxis, qmul, qrot, scale, sub, type Quat, type V3 } from '../../math.ts'
import type { Skeleton } from '../../skeleton.ts'
import { naturalCubic } from '../solve.ts'

// A smooth hand orientation along a row: the free roll search of the arm solve can step between two nearly equal hand
// rolls from one frame to the next (a one-frame wrist blip). Solving at knots along the contraction and passing the
// interpolated hand back as a fixed orientation keeps the wrists smooth.

const DISTAL: V3 = [0, -1, 0]

/** the left hand's world orientation by contraction c, from free solves at `n` knots (`solve(c)` returns the pose) */
export function handSchedule(skel: Skeleton, solve: (c: number) => Float64Array, n = 17): (c: number) => Quat {
  const axisL = skel.data.sites.grip_l.axis!
  const cs = Array.from({ length: n }, (_, k) => k / (n - 1))
  const frames = cs.map((c) => {
    const rot = fk(skel, solve(c)).rot[skel.seg.hand_l]
    return [...qrot(rot, axisL), ...qrot(rot, DISTAL)]
  })
  const curves = [0, 1, 2, 3, 4, 5].map((i) => naturalCubic(cs, frames.map((fr) => fr[i])))
  return (c) => {
    const x = Math.max(0, Math.min(1, c))
    const v = curves.map((f) => f(x))
    return qalign(axisL, DISTAL, norm([v[0], v[1], v[2]]), norm([v[3], v[4], v[5]]))
  }
}

/**
 * A fixed left-hand orientation round a handle along `axis` (world) with the fingers pointing `distal` (world, made
 * square to the axis) and the palm facing as near `palm` as the axis's two senses allow
 */
export function handOn(skel: Skeleton, axis: V3, distal: V3, palm: V3, oblique = 0): Quat {
  const site = skel.data.sites.grip_l
  const d = norm(sub(distal, scale(axis, dot(distal, axis))))
  let a = qalign(site.axis!, DISTAL, axis, d)
  if (dot(qrot(a, site.normal!), palm) < 0) a = qalign(site.axis!, DISTAL, scale(axis, -1), d)
  // the handle crossing the palm `oblique` deg off the hand's grip line (turned about the palm normal)
  return oblique ? qmul(a, qaxis(site.normal!, oblique * DEG)) : a
}

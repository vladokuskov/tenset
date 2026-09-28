import { frameImplements, frameQ, type Baked } from '../../bake.ts'
import { fk, sitePos } from '../../fk.ts'
import { siteWorld } from '../../implements.ts'
import { dist } from '../../math.ts'
import type { Skeleton } from '../../skeleton.ts'

// Checks shared by the F9 core template tests.

/** worst contact error (planted and grip) at frame i, m */
export function contactError(skel: Skeleton, b: Baked, i: number): number {
  const f = fk(skel, frameQ(b, i))
  const impl = frameImplements(b, i)
  let worst = 0
  for (const c of b.contacts) {
    const p = sitePos(skel, f, c.site)
    if ('world' in c.target) worst = Math.max(worst, dist(p, c.target.world))
    else {
      const { implement, grip } = c.target
      const k = b.implements.findIndex((s) => s.id === implement)
      worst = Math.max(worst, dist(p, siteWorld(b.implements[k], impl[k], grip).pos))
    }
  }
  return worst
}

/** largest jump across the loop seam relative to the largest step inside the loop, over every DOF (gate: <= 1.5) */
export function seamRatio(skel: Skeleton, b: Baked): number {
  let worst = 0
  for (const d of skel.dofs) {
    const x = Array.from({ length: b.frames }, (_, i) => b.q[i * b.nDof + d.index])
    const step = Math.max(...x.slice(1).map((v, i) => Math.abs(v - x[i])))
    const eps = d.unit === 'm' ? 0.0001 : 0.01
    worst = Math.max(worst, Math.abs(x[0] - x[b.frames - 1]) / (step + eps))
  }
  return worst
}

/** frame index at loop fraction u (0: middle of the top pause, 0.625: bottom pause with the default tempo) */
export const frameAt = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames

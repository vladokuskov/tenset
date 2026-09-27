// Seam-aware gutter: a texel just outside a UV island takes the value of the surface point it would map to if the
// island's edge triangle went on (found across the seam, in rest space), so filtered and finite-difference reads at
// an island edge see the neighbouring surface instead of a copy of the edge.
import type { FigureMesh } from './figure.ts'
import { KdTree } from './kdtree.ts'
import type { Texels } from './texels.ts'

/** Per texel: the inside texel whose value it carries (itself when inside), -1 beyond `radius` texels of every island. */
export function seamPadSources(T: Texels, fig: FigureMesh, radius: number): Int32Array {
  const N = T.res
  const src = new Int32Array(N * N).fill(-1)
  const near = new Int32Array(N * N).fill(-1)
  let front: number[] = []
  const ids: number[] = []
  for (let k = 0; k < N * N; k++) if (T.tri[k] >= 0) {
    near[k] = k
    src[k] = k
    front.push(k)
    ids.push(k)
  }
  for (let r = 0; r < radius && front.length; r++) {
    const next: number[] = []
    for (const k of front) {
      const x = k % N, y = (k - x) / N
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue
        const j = yy * N + xx
        if (near[j] >= 0) continue
        near[j] = near[k]
        next.push(j)
      }
    }
    front = next
  }
  const pts = new Float32Array(ids.length * 3)
  ids.forEach((k, i) => pts.set(T.rest.subarray(k * 3, k * 3 + 3), i * 3))
  const tree = new KdTree(pts)
  const uv = fig.uv, I = fig.indices, R = fig.rest
  for (let j = 0; j < N * N; j++) {
    if (src[j] >= 0 || near[j] < 0) continue
    const s = near[j]
    const t = T.tri[s]
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2]
    const ax = uv[a * 2] * N, ay = uv[a * 2 + 1] * N, bx = uv[b * 2] * N, by = uv[b * 2 + 1] * N, cx = uv[c * 2] * N, cy = uv[c * 2 + 1] * N
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    const px = (j % N) + 0.5, py = Math.floor(j / N) + 0.5
    const l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
    const l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
    const l2 = 1 - l0 - l1
    const p = [0, 1, 2].map((q) => (l0 * R[a * 3 + q] + l1 * R[b * 3 + q] + l2 * R[c * 3 + q]) * 1000)
    const size = Math.hypot(T.rest[s * 3] - p[0], T.rest[s * 3 + 1] - p[1], T.rest[s * 3 + 2] - p[2])
    const hit = tree.nearest(p[0], p[1], p[2], Math.max(2, size))
    src[j] = hit ? ids[hit[0]] : s
  }
  return src
}

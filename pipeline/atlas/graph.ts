// Texel graph over the body surface: UV 4-neighbours inside each island plus links across UV seams (island-edge
// texels joined to the nearest edge texel on the other side, in rest space). Fields solved or smoothed on it stay
// continuous across seams, which UV-space filters can't do.
import { KdTree } from './kdtree.ts'
import type { Texels } from './texels.ts'

export type TexelGraph = {
  /** node -> texel index */
  texel: Int32Array
  /** texel -> node, -1 outside */
  node: Int32Array
  /** CSR adjacency */
  start: Int32Array
  nb: Int32Array
  w: Float32Array
  seamLinks: number
  stride: number
}

/** `stride` > 1 keeps every stride-th texel in u and v (a coarse level for the dome solve). */
export function buildGraph(T: Texels, area: Float32Array, stride = 1): TexelGraph {
  const N = T.res
  const st = stride
  const node = new Int32Array(N * N).fill(-1)
  const list: number[] = []
  for (let y = 0; y < N; y += st) for (let x = 0; x < N; x += st) {
    const k = y * N + x
    if (T.tri[k] < 0) continue
    node[k] = list.length
    list.push(k)
  }
  const texel = Int32Array.from(list)
  const n = texel.length
  const R = T.rest
  const dist = (a: number, b: number) => Math.hypot(R[a * 3] - R[b * 3], R[a * 3 + 1] - R[b * 3 + 1], R[a * 3 + 2] - R[b * 3 + 2])
  const size = (k: number) => (Math.sqrt(area[k]) || 0.85) * st
  const has = (k: number, dx: number, dy: number) => {
    const x = (k % N) + dx * st, y = Math.floor(k / N) + dy * st
    return x >= 0 && y >= 0 && x < N && y < N && node[y * N + x] >= 0
  }

  // seam links between island-edge texels
  const edge: number[] = []
  for (const k of texel) {
    if (!has(k, 1, 0) || !has(k, -1, 0) || !has(k, 0, 1) || !has(k, 0, -1)) edge.push(k)
  }
  const pts = new Float32Array(edge.length * 3)
  edge.forEach((k, i) => pts.set(R.subarray(k * 3, k * 3 + 3), i * 3))
  const tree = new KdTree(pts)
  const links: [number, number][] = []
  for (const k of edge) {
    const x = k % N, y = (k - x) / N
    const r = tree.nearest(R[k * 3], R[k * 3 + 1], R[k * 3 + 2], 3.5 * size(k), (i) => {
      const j = edge[i]
      const xj = j % N, yj = (j - xj) / N
      return Math.max(Math.abs(xj - x), Math.abs(yj - y)) > 3 * st
    })
    if (r) links.push([node[k], node[edge[r[0]]]])
  }

  const deg = new Int32Array(n + 1)
  const add = (a: number, b: number) => {
    deg[a]++
    deg[b]++
  }
  for (let i = 0; i < n; i++) {
    const k = texel[i]
    if (has(k, 1, 0)) add(i, node[k + st])
    if (has(k, 0, 1)) add(i, node[k + st * N])
  }
  for (const [a, b] of links) add(a, b)
  const start = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i]
  const fill = start.slice(0, n)
  const nb = new Int32Array(start[n])
  const w = new Float32Array(start[n])
  const put = (a: number, b: number) => {
    const ka = texel[a], kb = texel[b]
    const h = 0.5 * (size(ka) + size(kb))
    const d = Math.max(dist(ka, kb), 0.35 * h)
    const wt = 1 / (d * d)
    nb[fill[a]] = b
    w[fill[a]++] = wt
    nb[fill[b]] = a
    w[fill[b]++] = wt
  }
  for (let i = 0; i < n; i++) {
    const k = texel[i]
    if (has(k, 1, 0)) put(i, node[k + st])
    if (has(k, 0, 1)) put(i, node[k + st * N])
  }
  for (const [a, b] of links) put(a, b)
  return { texel, node, start, nb, w, seamLinks: links.length, stride: st }
}

/**
 * Poisson domes: per region r (> 0), solves lap(u) = -src inside r with u = 0 on the other regions (Gauss-Seidel SOR).
 * `region` and `src` are per node; region <= 0 nodes stay 0.
 */
export function solveDomes(g: TexelGraph, region: Int32Array, src: Float32Array, u: Float32Array, { iterations = 1200, omega = 1.9, tol = 2e-4, log = undefined as ((s: string) => void) | undefined } = {}) {
  const { start, nb, w } = g
  const n = region.length
  let umax = 0
  for (let i = 0; i < n; i++) umax = Math.max(umax, u[i])
  for (let it = 0; it < iterations; it++) {
    let change = 0
    for (let i = 0; i < n; i++) {
      const r = region[i]
      if (r <= 0) continue
      let s = 0, ws = 0
      for (let e = start[i]; e < start[i + 1]; e++) {
        const wt = w[e]
        ws += wt
        if (region[nb[e]] === r) s += wt * u[nb[e]]
      }
      const d = omega * ((s + src[i]) / ws - u[i])
      u[i] += d
      const a = d < 0 ? -d : d
      if (a > change) change = a
    }
    umax = 0
    for (let i = 0; i < n; i++) if (u[i] > umax) umax = u[i]
    if (it % 200 === 0) log?.(`  dome sweep ${it}: max change ${(change / umax).toExponential(2)} of peak`)
    if (change < tol * umax) {
      log?.(`  domes converged after ${it + 1} sweeps`)
      return it + 1
    }
  }
  return iterations
}

/** Heat-diffusion smoothing on the graph (roughly a Gaussian of sigma = sqrt(steps * rate / 2) texels); `mask` limits which nodes change. */
export function diffuse(g: TexelGraph, f: Float32Array, steps: number, rate = 0.8, mask?: Float32Array) {
  const { start, nb, w } = g
  const n = f.length
  let a: Float32Array = f, b: Float32Array = new Float32Array(n)
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < n; i++) {
      let sum = 0, ws = 0
      for (let e = start[i]; e < start[i + 1]; e++) {
        sum += w[e] * a[nb[e]]
        ws += w[e]
      }
      const t = ws ? sum / ws : a[i]
      b[i] = a[i] + (mask ? mask[i] : 1) * rate * (t - a[i])
    }
    ;[a, b] = [b, a]
  }
  return a
}

/** Bilinear transfer of a coarse-level field to a finer level, only from coarse nodes of the same region. */
export function prolong(coarse: TexelGraph, uc: Float32Array, regionC: Int32Array, fine: TexelGraph, uf: Float32Array, regionF: Int32Array, N: number) {
  const sc = coarse.stride
  for (let i = 0; i < fine.texel.length; i++) {
    const r = regionF[i]
    if (r <= 0) continue
    const k = fine.texel[i]
    const x = k % N, y = (k - x) / N
    const x0 = Math.floor(x / sc) * sc, y0 = Math.floor(y / sc) * sc
    const fx = (x - x0) / sc, fy = (y - y0) / sc
    let s = 0, ws = 0
    for (const [dx, dy, wt] of [[0, 0, (1 - fx) * (1 - fy)], [sc, 0, fx * (1 - fy)], [0, sc, (1 - fx) * fy], [sc, sc, fx * fy]]) {
      const xx = x0 + dx, yy = y0 + dy
      if (xx >= N || yy >= N || wt <= 0) continue
      const j = coarse.node[yy * N + xx]
      if (j < 0 || regionC[j] !== r) continue
      s += wt * uc[j]
      ws += wt
    }
    if (ws > 0.05) uf[i] = s / ws
  }
}

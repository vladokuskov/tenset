// Label clean-up in UV space: fill texels the projection missed, drop specks, pad islands for seam-safe sampling.
import type { Texels } from './texels.ts'

export const UNKNOWN = 0xffff

/** Surface area of one texel in mm², per texel, from the rest mesh. */
export function texelArea(T: Texels, rest: Float32Array, uv: Float32Array, indices: Uint32Array) {
  const N = T.res
  const triArea = new Float32Array(indices.length / 3)
  for (let t = 0; t < triArea.length; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
    const ux = rest[b * 3] - rest[a * 3], uy = rest[b * 3 + 1] - rest[a * 3 + 1], uz = rest[b * 3 + 2] - rest[a * 3 + 2]
    const vx = rest[c * 3] - rest[a * 3], vy = rest[c * 3 + 1] - rest[a * 3 + 1], vz = rest[c * 3 + 2] - rest[a * 3 + 2]
    const area3 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2 * 1e6
    const du1 = (uv[b * 2] - uv[a * 2]) * N, dv1 = (uv[b * 2 + 1] - uv[a * 2 + 1]) * N
    const du2 = (uv[c * 2] - uv[a * 2]) * N, dv2 = (uv[c * 2 + 1] - uv[a * 2 + 1]) * N
    const areaUv = Math.abs(du1 * dv2 - du2 * dv1) / 2
    triArea[t] = areaUv > 1e-9 ? area3 / areaUv : 0
  }
  const out = new Float32Array(N * N)
  for (let k = 0; k < N * N; k++) if (T.tri[k] >= 0) out[k] = triArea[T.tri[k]]
  return out
}

const NB8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]

/** Fills UNKNOWN texels inside islands with the most common known neighbour, repeatedly. */
export function fillUnknown(L: Uint16Array, inside: (k: number) => boolean, N: number, maxIter = 400) {
  let todo: number[] = []
  for (let k = 0; k < N * N; k++) if (L[k] === UNKNOWN && inside(k)) todo.push(k)
  const counts = new Map<number, number>()
  for (let iter = 0; iter < maxIter && todo.length; iter++) {
    const next: number[] = []
    const set: [number, number][] = []
    for (const k of todo) {
      const x = k % N, y = (k - x) / N
      counts.clear()
      for (const [dx, dy] of NB8) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue
        const v = L[yy * N + xx]
        if (v !== UNKNOWN && inside(yy * N + xx)) counts.set(v, (counts.get(v) ?? 0) + 1)
      }
      let best = -1, bc = 0
      for (const [v, c] of counts) if (c > bc) { best = v; bc = c }
      if (best >= 0) set.push([k, best])
      else next.push(k)
    }
    for (const [k, v] of set) L[k] = v
    todo = next
  }
  return todo.length
}

/** Connected pieces (8-neighbour, inside islands) of each value smaller than minArea become UNKNOWN. */
export function dropSpecks(L: Uint16Array, inside: (k: number) => boolean, area: Float32Array, N: number, minArea: (value: number) => number) {
  const seen = new Uint8Array(N * N)
  const stack: number[] = []
  let dropped = 0
  for (let s = 0; s < N * N; s++) {
    if (seen[s] || !inside(s) || L[s] === UNKNOWN) continue
    const v = L[s]
    const piece: number[] = []
    let a = 0
    seen[s] = 1
    stack.push(s)
    while (stack.length) {
      const k = stack.pop()!
      piece.push(k)
      a += area[k]
      const x = k % N, y = (k - x) / N
      for (const [dx, dy] of NB8) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue
        const j = yy * N + xx
        if (!seen[j] && inside(j) && L[j] === v) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    if (a < minArea(v)) {
      for (const k of piece) L[k] = UNKNOWN
      dropped++
    }
  }
  return dropped
}

/** Grows island values outward by `radius` texels (nearest filled neighbour), so seams never sample empty texels. */
export function pad<T extends Uint8Array | Uint16Array | Float32Array>(data: T, channels: number, filled: Uint8Array, N: number, radius: number) {
  let front = filled.slice()
  for (let r = 0; r < radius; r++) {
    const next = front.slice()
    for (let k = 0; k < N * N; k++) {
      if (front[k]) continue
      const x = k % N, y = (k - x) / N
      let src = -1
      for (const [dx, dy] of NB8) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue
        if (front[yy * N + xx]) {
          src = yy * N + xx
          if (dx === 0 || dy === 0) break
        }
      }
      if (src < 0) continue
      for (let c = 0; c < channels; c++) data[k * channels + c] = data[src * channels + c]
      next[k] = 1
    }
    front = next
  }
  return front
}

/**
 * Bare-skin texels in a gap narrower than `widthMm(group)` between two texels of the same region or of two regions in
 * one group take the nearer side's label (split heads of one muscle, oblique aponeurosis holes).
 */
export function closeGaps(L: Uint16Array, inside: (k: number) => boolean, area: Float32Array, N: number, widthMm: (group: string | null) => number, groupOf: (v: number) => string | null) {
  const out = L.slice()
  const dirs = [[1, 0, 1], [0, 1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2]]
  let maxWidth = 0
  for (let v = 1; v < 256; v++) maxWidth = Math.max(maxWidth, widthMm(groupOf(v)))
  let changed = 0
  for (let k = 0; k < N * N; k++) {
    if (L[k] !== 0 || !inside(k)) continue
    const s = Math.sqrt(area[k]) || 1
    const R = Math.min(32, Math.ceil(maxWidth / s))
    const x = k % N, y = (k - x) / N
    let best = -1, bestW = Infinity
    for (const [dx, dy, len] of dirs) {
      const probe = (sg: number) => {
        for (let i = 1; i <= R; i++) {
          const xx = x + dx * i * sg, yy = y + dy * i * sg
          if (xx < 0 || yy < 0 || xx >= N || yy >= N) return null
          const j = yy * N + xx
          if (!inside(j)) return null
          if (L[j] !== 0) return [L[j], i] as const
        }
        return null
      }
      const a = probe(1), b = probe(-1)
      if (!a || !b) continue
      const w = (a[1] + b[1]) * len * s
      const ga = groupOf(a[0])
      if (w > widthMm(ga) || w >= bestW) continue
      if (a[0] !== b[0] && (!ga || ga !== groupOf(b[0]))) continue
      bestW = w
      best = a[1] <= b[1] ? a[0] : b[0]
    }
    if (best >= 0) {
      out[k] = best
      changed++
    }
  }
  L.set(out)
  return changed
}

/**
 * Bare-skin islands smaller than `maxMm2` that are enclosed by muscle (not by an island edge) are filled: from the
 * one region around them, or split between several by growing from the rim (gaps between interdigitating slips).
 */
/** Fills bare-skin holes smaller than maxMm2 that are fully enclosed by labels; `allowed` limits which labels may enclose. */
export function fillHoles(L: Uint16Array, inside: (k: number) => boolean, area: Float32Array, N: number, maxMm2: number, allowed?: (label: number) => boolean) {
  const seen = new Uint8Array(N * N)
  let filled = 0
  for (let s = 0; s < N * N; s++) {
    if (seen[s] || L[s] !== 0 || !inside(s)) continue
    const piece: number[] = []
    const stack = [s]
    seen[s] = 1
    let a = 0, edge = false, around = -1, mixed = false
    while (stack.length) {
      const k = stack.pop()!
      piece.push(k)
      a += area[k]
      const x = k % N, y = (k - x) / N
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) { edge = true; continue }
        const j = yy * N + xx
        if (!inside(j)) { edge = true; continue }
        if (L[j] === 0) {
          if (!seen[j]) { seen[j] = 1; stack.push(j) }
        } else {
          if (allowed && !allowed(L[j])) edge = true
          if (around < 0) around = L[j]
          else if (around !== L[j]) mixed = true
        }
      }
    }
    if (!edge && around > 0 && a < maxMm2) {
      for (const k of piece) L[k] = mixed ? UNKNOWN : around
      filled++
    }
  }
  fillUnknown(L, inside, N)
  return filled
}

/** Majority filter over a (2r+1)² window inside islands, applied to boundary texels only. */
export function modeFilter(L: Uint16Array, inside: (k: number) => boolean, N: number, r: number, iterations: number) {
  const counts = new Map<number, number>()
  for (let it = 0; it < iterations; it++) {
    const out = L.slice()
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const k = y * N + x
        if (!inside(k)) continue
        const v = L[k]
        if (
          (x + 1 >= N || L[k + 1] === v || !inside(k + 1)) && (x < 1 || L[k - 1] === v || !inside(k - 1)) &&
          (y + 1 >= N || L[k + N] === v || !inside(k + N)) && (y < 1 || L[k - N] === v || !inside(k - N))
        ) continue
        counts.clear()
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= N) continue
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= N || !inside(yy * N + xx)) continue
            const w = L[yy * N + xx]
            counts.set(w, (counts.get(w) ?? 0) + 1)
          }
        }
        let best = v, bc = counts.get(v) ?? 0
        for (const [w, c] of counts) if (c > bc) { best = w; bc = c }
        out[k] = best
      }
    }
    L.set(out)
  }
}

/** Like pad, for a height field: extends each island linearly (2 h1 - h2 along the step), so finite differences
 * at the island edge keep their slope instead of flattening into a seam line. */
export function padLinear(data: Float32Array, filled: Uint8Array, N: number, radius: number) {
  let front = filled.slice()
  for (let r = 0; r < radius; r++) {
    const next = front.slice()
    const vals: [number, number][] = []
    for (let k = 0; k < N * N; k++) {
      if (front[k]) continue
      const x = k % N, y = (k - x) / N
      let sum = 0, n = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x1 = x + dx, y1 = y + dy, x2 = x + 2 * dx, y2 = y + 2 * dy
        if (x1 < 0 || y1 < 0 || x1 >= N || y1 >= N || !front[y1 * N + x1]) continue
        const h1 = data[y1 * N + x1]
        const h2 = x2 >= 0 && y2 >= 0 && x2 < N && y2 < N && front[y2 * N + x2] ? data[y2 * N + x2] : h1
        sum += 2 * h1 - h2
        n++
      }
      if (n) vals.push([k, sum / n])
    }
    for (const [k, v] of vals) {
      data[k] = v
      next[k] = 1
    }
    front = next
  }
  return front
}

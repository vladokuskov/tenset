// Muscle relief: a height field built per texel (rounded belly from the 3D distance to the belly's boundary,
// a shallow groove at the boundary) and a separate fibre striation signal along each muscle's fibre field,
// stored as two 8-bit maps in the body UV layout. The skin shader derives normals and cavity from them.
import path from 'node:path'
import { bp3dLandmarks, bpMesh, type Vec } from './bp3d.ts'
import type { Segment } from './anatomy3d.ts'
import type { FigureMesh } from './figure.ts'
import { KdTree } from './kdtree.ts'
import { padLinear, UNKNOWN } from './labels.ts'
import type { Texels } from './texels.ts'
import { writePng } from './webp.ts'

export const RELIEF = {
  /** boundary distance cap (mm) */
  dMax: 45,
  /** belly height = k * belly radius, clamped (mm) */
  bellyK: 0.15,
  bellyMin: 1.0,
  bellyMax: 5.5,
  /** half-width of the rounded valley at a belly boundary (mm) */
  valley: 1.6,
  /** belly reaches full height at this fraction of its radius */
  plateau: 0.8,
  /** blur of the belly shapes (mm) */
  blurMm: 2.2,
  /** extra dip between two different regions (mm) and its width (mm) */
  grooveRegion: 0.35,
  grooveWidth: 2.8,
  /** muscles outside the region table with less visible area than this stay flat (mm²) */
  minOccluderMm2: 3000,
  /** fibre striation: wavelength and amplitude (mm) */
  fiberLambda: 4.6,
  fiberAmp: 0.055,
  quality: 94,
  fibreQuality: 70,
  /** bellies smoothed wider (serratus slips): blur (mm) and height factor */
  softBlurMm: 5,
  softAmp: 0.8,
}

const SOFT = /serratus anterior/

type Input = {
  T: Texels
  /** mm² per texel */
  area: Float32Array
  S: Uint16Array
  segments: Segment[]
  bones: Set<string>
  fig: FigureMesh
  debug: string | null
}

type Belly = {
  key: string
  flat: boolean
  texels: number
  radius: number
  amp: number
  /** fibre field: stripes are level sets of the angle around `axis` through `c` */
  c: Vec
  a1: Vec
  a2: Vec
  rRef: number
  label: number
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: Vec): Vec => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s]
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function hash3(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = x - xi, yf = y - yi, zf = z - zi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  )
}

/** Principal axes of a point set (power iteration on the covariance). */
function pca(pts: Float32Array) {
  const n = pts.length / 3
  const c: Vec = [0, 0, 0]
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += pts[i * 3 + k] / n
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < n; i++) {
    const d = [pts[i * 3] - c[0], pts[i * 3 + 1] - c[1], pts[i * 3 + 2] - c[2]]
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += (d[a] * d[b]) / n
  }
  let v: Vec = [0.3, 0.5, 0.8]
  for (let it = 0; it < 60; it++) v = norm([dot(C[0] as Vec, v), dot(C[1] as Vec, v), dot(C[2] as Vec, v)])
  return { c, e1: v }
}

export function bakeRelief({ T, area, S, segments, bones, fig, debug }: Input) {
  const N = T.res
  const inside = (k: number) => T.tri[k] >= 0
  const landmarks = bp3dLandmarks()

  // --- bellies: one per muscle concept (split parts of one concept share a belly) or hand-polygon belly ---
  const bellyOfSeg = new Int32Array(segments.length + 1).fill(-1)
  const bellies: Belly[] = []
  const byKey = new Map<string, number>()
  segments.forEach((s, i) => {
    const flat = !s.side && s.files.every((f) => bones.has(f))
    const key = flat ? 'flat' : `${s.concept}:${s.side ?? ''}`
    let b = byKey.get(key)
    if (b === undefined) {
      b = bellies.length
      byKey.set(key, b)
      bellies.push({ key, flat, texels: 0, radius: 0, amp: 0, c: [0, 0, 0], a1: [1, 0, 0], a2: [0, 1, 0], rRef: 1, label: s.label })
    }
    bellyOfSeg[i + 1] = b
  })
  const FLAT = byKey.get('flat') ?? bellies.push({ key: 'flat', flat: true, texels: 0, radius: 0, amp: 0, c: [0, 0, 0], a1: [1, 0, 0], a2: [0, 1, 0], rRef: 1, label: 0 }) - 1
  bellyOfSeg[0] = FLAT
  const B = new Int32Array(N * N).fill(-1)
  for (let k = 0; k < N * N; k++) if (inside(k)) B[k] = S[k] === UNKNOWN ? FLAT : bellyOfSeg[S[k]]
  // small muscles outside the region table (neck straps, hand and foot muscles) would only add clutter
  const bellyArea = new Float64Array(bellies.length)
  for (let k = 0; k < N * N; k++) if (B[k] >= 0) bellyArea[B[k]] += area[k]
  bellies.forEach((b, i) => {
    if (!b.flat && b.label === 0 && bellyArea[i] < RELIEF.minOccluderMm2) b.flat = true
  })
  for (let k = 0; k < N * N; k++) if (B[k] >= 0 && bellies[B[k]].flat) B[k] = FLAT

  // --- rest normals per texel (welded, interpolated) ---
  const nv = fig.rest.length / 3
  const wn = new Float32Array(fig.weldCount * 3)
  const I = fig.indices, R = fig.rest
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2]
    const e1 = sub([R[b * 3], R[b * 3 + 1], R[b * 3 + 2]], [R[a * 3], R[a * 3 + 1], R[a * 3 + 2]])
    const e2 = sub([R[c * 3], R[c * 3 + 1], R[c * 3 + 2]], [R[a * 3], R[a * 3 + 1], R[a * 3 + 2]])
    const n = cross(e1, e2)
    for (const v of [a, b, c]) for (let q = 0; q < 3; q++) wn[fig.weld[v] * 3 + q] += n[q]
  }
  const vn = new Float32Array(nv * 3)
  for (let i = 0; i < nv; i++) vn.set(norm([wn[fig.weld[i] * 3], wn[fig.weld[i] * 3 + 1], wn[fig.weld[i] * 3 + 2]]), i * 3)
  const restN = new Float32Array(N * N * 3)
  for (let k = 0; k < N * N; k++) {
    const t = T.tri[k]
    if (t < 0) continue
    const l0 = T.bary[k * 2], l1 = T.bary[k * 2 + 1], l2 = 1 - l0 - l1
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2]
    restN.set(norm([0, 1, 2].map((q) => l0 * vn[a * 3 + q] + l1 * vn[b * 3 + q] + l2 * vn[c * 3 + q]) as Vec), k * 3)
  }

  // --- boundary points between bellies (midpoints of UV-adjacent texels, rest space) ---
  const bp: number[] = [], bn: number[] = [], pairA: number[] = [], pairB: number[] = []
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = y * N + x
      if (B[k] < 0) continue
      for (const j of [x + 1 < N ? k + 1 : -1, y + 1 < N ? k + N : -1]) {
        if (j < 0 || B[j] < 0 || B[j] === B[k]) continue
        const gap = Math.hypot(T.rest[k * 3] - T.rest[j * 3], T.rest[k * 3 + 1] - T.rest[j * 3 + 1], T.rest[k * 3 + 2] - T.rest[j * 3 + 2])
        if (gap > 6) continue
        for (let q = 0; q < 3; q++) {
          bp.push((T.rest[k * 3 + q] + T.rest[j * 3 + q]) / 2)
          bn.push(restN[k * 3 + q] + restN[j * 3 + q])
        }
        pairA.push(B[k])
        pairB.push(B[j])
      }
    }
  }
  const tree = new KdTree(Float32Array.from(bp))

  // --- distance to the own belly's boundary ---
  const D = new Float32Array(N * N).fill(RELIEF.dMax)
  const other = new Int32Array(N * N).fill(-1)
  for (let k = 0; k < N * N; k++) {
    const b = B[k]
    if (b < 0 || bellies[b].flat) continue
    const nx = restN[k * 3], ny = restN[k * 3 + 1], nz = restN[k * 3 + 2]
    const r = tree.nearest(T.rest[k * 3], T.rest[k * 3 + 1], T.rest[k * 3 + 2], RELIEF.dMax, (i) =>
      (pairA[i] === b || pairB[i] === b) && bn[i * 3] * nx + bn[i * 3 + 1] * ny + bn[i * 3 + 2] * nz > 0.6)
    if (!r) continue
    D[k] = r[1]
    other[k] = pairA[r[0]] === b ? pairB[r[0]] : pairA[r[0]]
  }

  // --- belly sizes and fibre fields ---
  const dists: number[][] = bellies.map(() => [])
  const navg: Vec[] = bellies.map(() => [0, 0, 0])
  const sAvg: Vec[] = bellies.map(() => [0, 0, 0])
  const sCount = new Float64Array(bellies.length)
  for (let k = 0; k < N * N; k++) {
    const b = B[k]
    if (b < 0) continue
    bellies[b].texels++
    if (bellies[b].flat || Number.isNaN(T.skin[k * 3])) continue
    if ((k & 3) === 0) dists[b].push(D[k])
    sCount[b]++
    for (let q = 0; q < 3; q++) {
      navg[b][q] += T.skinN[k * 3 + q]
      sAvg[b][q] += T.skin[k * 3 + q]
    }
  }
  const segOfBelly = new Map<number, Segment>()
  segments.forEach((s, i) => {
    if (!segOfBelly.has(bellyOfSeg[i + 1])) segOfBelly.set(bellyOfSeg[i + 1], s)
  })
  bellies.forEach((belly, b) => {
    if (belly.flat || !belly.texels) return
    const ds = dists[b].sort((x, y) => x - y)
    belly.radius = Math.max(4, ds[Math.floor(ds.length * 0.97)] ?? 4)
    belly.amp = Math.min(RELIEF.bellyMax, Math.max(RELIEF.bellyMin, RELIEF.bellyK * belly.radius))
    const n = norm(navg[b])
    const centroid = scale(sAvg[b], 1 / Math.max(1, sCount[b]))
    const seg = segOfBelly.get(b)!
    let c: Vec
    if (seg.key.startsWith('rectus_abdominis')) {
      c = add(centroid, [0, 0, 5000])
    } else if (seg.key.startsWith('latissimus_dorsi')) {
      c = landmarks[`upperarm01_${seg.side === 'l' ? 'L' : 'R'}`]
    } else {
      const pts = concat(seg.files.map((f) => bpMesh(f).positions))
      const pc = pca(pts)
      const e1 = pc.e1
      // taper: spread near each end of the axis decides where fibres converge
      let tmin = Infinity, tmax = -Infinity
      for (let i = 0; i < pts.length; i += 3) {
        const t = dot(sub([pts[i], pts[i + 1], pts[i + 2]], pc.c), e1)
        tmin = Math.min(tmin, t)
        tmax = Math.max(tmax, t)
      }
      const L = tmax - tmin
      const spread = (lo: number, hi: number) => {
        let s = 0, m = 0
        const cen: Vec = [0, 0, 0]
        for (let i = 0; i < pts.length; i += 3) {
          const p: Vec = [pts[i], pts[i + 1], pts[i + 2]]
          const t = dot(sub(p, pc.c), e1)
          if (t < lo || t > hi) continue
          const off = sub(sub(p, pc.c), scale(e1, t))
          s += dot(off, off)
          for (let q = 0; q < 3; q++) cen[q] += p[q]
          m++
        }
        return { w: Math.sqrt(s / Math.max(1, m)), cen: scale(cen, 1 / Math.max(1, m)) }
      }
      const lo = spread(tmin, tmin + 0.18 * L), hi = spread(tmax - 0.18 * L, tmax)
      const narrow = lo.w < hi.w ? lo : hi, wide = lo.w < hi.w ? hi : lo
      const u = norm(sub(narrow.cen, wide.cen))
      const ratio = wide.w / Math.max(1e-3, narrow.w)
      const beyond = ratio > 1.5 ? Math.min(5000, (L * narrow.w) / Math.max(1e-3, wide.w - narrow.w)) : 5000
      c = add(narrow.cen, scale(u, beyond))
    }
    // fan plane: perpendicular to the belly's mean skin normal
    const toC = sub(centroid, c)
    const a1 = norm(sub(toC, scale(n, dot(toC, n))))
    belly.c = c
    belly.a1 = a1
    belly.a2 = cross(n, a1)
    belly.rRef = Math.hypot(...sub(centroid, c))
  })

  // --- height field: belly shapes, blurred inside each UV island to round off the distance field's ridges, then fibres ---
  const base = new Float32Array(N * N)
  const fibre = new Float32Array(N * N)
  const labelOfBelly = (b: number) => bellies[b].label
  for (let k = 0; k < N * N; k++) {
    const b = B[k]
    if (b < 0 || Number.isNaN(T.skin[k * 3])) continue
    const s: Vec = [T.skin[k * 3], T.skin[k * 3 + 1], T.skin[k * 3 + 2]]
    const mask = reliefMask(s)
    if (!mask) continue
    const belly = bellies[b]
    if (belly.flat) continue
    // rounded belly over a soft distance, so the valley at the boundary has a round bottom
    const d = D[k]
    const w = RELIEF.valley
    const t = Math.min(1, (Math.sqrt(d * d + w * w) - w) / (belly.radius * RELIEF.plateau))
    let h = belly.amp * (1 - (1 - t) * (1 - t))
    const o = other[k]
    if (o >= 0 && !bellies[o].flat && labelOfBelly(o) !== belly.label) h -= RELIEF.grooveRegion * Math.exp(-((d / RELIEF.grooveWidth) ** 2))
    base[k] = h * mask
    // fibres: level sets of the angle around the convergence point, warped a little so they read organic
    const rel = sub(s, belly.c)
    const theta = Math.atan2(dot(rel, belly.a2), dot(rel, belly.a1))
    const w1 = noise3(s[0] / 22, s[1] / 22, s[2] / 22) - 0.5
    const w2 = noise3(s[0] / 7 + 31, s[1] / 7, s[2] / 7) - 0.5
    const phase = (theta * belly.rRef) / RELIEF.fiberLambda + 0.9 * w1 + 0.25 * w2
    const fib = 0.72 * Math.sin(2 * Math.PI * phase) + 0.28 * Math.sin(2 * Math.PI * (phase * 2.07 + 0.4 * w1))
    const ampMod = 0.55 + 0.9 * noise3(s[0] / 14 + 7, s[1] / 14, s[2] / 14)
    fibre[k] = RELIEF.fiberAmp * fib * ampMod * smoothstep(1, 4, d) * mask
  }
  const island = islands(inside, N)
  let areaSum = 0, areaN = 0
  for (let k = 0; k < N * N; k += 7) if (inside(k) && area[k] > 0) { areaSum += Math.sqrt(area[k]); areaN++ }
  const sigma = RELIEF.blurMm / (areaSum / areaN)
  const Hh = blurIslands(base, island, N, sigma)
  // the serratus slips come out ragged at this scale: blur them wider and flatter, so they read as soft digits
  const softMask = new Float32Array(N * N)
  for (let k = 0; k < N * N; k++) if (B[k] >= 0 && SOFT.test(bellies[B[k]].key)) softMask[k] = 1
  const sigmaSoft = RELIEF.softBlurMm / (areaSum / areaN)
  const soft = blurIslands(base, island, N, sigmaSoft)
  const softW = blurIslands(softMask, island, N, sigmaSoft)
  for (let k = 0; k < N * N; k++) Hh[k] += (soft[k] * RELIEF.softAmp - Hh[k]) * softW[k]
  // the blur only sees one side of a UV seam, so fade back to the unblurred (seam-continuous) shape at island edges
  const edge = edgeDistance(island, N, Math.ceil(sigmaSoft * 3))
  for (let k = 0; k < N * N; k++) {
    const f = smoothstep(0, sigma * 3, edge[k])
    const fs = smoothstep(0, sigmaSoft * 3, edge[k])
    Hh[k] = base[k] + (Hh[k] - base[k]) * Math.min(f, softW[k] > 0.01 ? fs : 1)
  }

  // --- 8-bit height, padded past island borders so the shader's finite differences never read empty texels ---
  let hmin = Infinity, hmax = -Infinity
  for (let k = 0; k < N * N; k++) if (inside(k)) {
    hmin = Math.min(hmin, Hh[k])
    hmax = Math.max(hmax, Hh[k])
  }
  hmin = Math.floor(hmin * 10) / 10
  hmax = Math.ceil(hmax * 10) / 10
  const filled = new Uint8Array(N * N)
  for (let k = 0; k < N * N; k++) if (inside(k)) filled[k] = 1
  const padded = padLinear(Hh, filled, N, 12)
  const zero = Math.round((-hmin / (hmax - hmin)) * 255)
  const height = new Uint8Array(N * N * 4)
  for (let k = 0; k < N * N; k++) {
    const g = padded[k] ? Math.max(0, Math.min(255, Math.round(((Hh[k] - hmin) / (hmax - hmin)) * 255))) : zero
    height.set([g, g, g, 255], k * 4)
  }
  if (debug) writePng(path.join(debug, 'atlas-uv-height.png'), N, N, height)

  // fibres get their own 8-bit channel (128 = flat), so they keep full precision next to the smooth bellies
  const fMax = RELIEF.fiberAmp * 1.45
  const fib = fibre.slice()
  const fFilled = filled.slice()
  for (let r = 0; r < 12; r++) {
    const set: [number, number][] = []
    for (let k = 0; k < N * N; k++) {
      if (fFilled[k]) continue
      const x = k % N
      let sum = 0, n = 0
      for (const j of [x + 1 < N ? k + 1 : -1, x > 0 ? k - 1 : -1, k + N < N * N ? k + N : -1, k - N]) {
        if (j >= 0 && fFilled[j]) { sum += fib[j]; n++ }
      }
      if (n) set.push([k, sum / n])
    }
    for (const [k, v] of set) { fib[k] = v; fFilled[k] = 1 }
  }
  const fibreTex = new Uint8Array(N * N * 4)
  for (let k = 0; k < N * N; k++) {
    const g = Math.max(0, Math.min(255, Math.round(128 + (fib[k] / fMax) * 127)))
    fibreTex.set([g, g, g, 255], k * 4)
  }
  return { res: N, height, fibre: fibreTex, fibreMm: fMax, fibreQuality: RELIEF.fibreQuality, minMm: hmin, maxMm: hmax, quality: RELIEF.quality, bellies: bellies.length, boundaryPoints: pairA.length }
}

/** Relief fades out on the face, hands and feet (BodyParts3D millimetres). */
function reliefMask(s: Vec) {
  const z = s[2], lat = Math.abs(s[0])
  let m = smoothstep(1505, 1455, z)
  if (lat > 150 && z < 900) m *= smoothstep(790, 835, z)
  m *= smoothstep(55, 95, z)
  return m
}

function concat(arrays: Float32Array[]) {
  const out = new Float32Array(arrays.reduce((a, b) => a + b.length, 0))
  let o = 0
  for (const a of arrays) {
    out.set(a, o)
    o += a.length
  }
  return out
}

/** connected UV islands (4-neighbour), id per texel, -1 outside */
function islands(inside: (k: number) => boolean, N: number) {
  const id = new Int32Array(N * N).fill(-1)
  let next = 0
  const stack: number[] = []
  for (let s = 0; s < N * N; s++) {
    if (id[s] >= 0 || !inside(s)) continue
    id[s] = next
    stack.push(s)
    while (stack.length) {
      const k = stack.pop()!
      const x = k % N
      for (const j of [x + 1 < N ? k + 1 : -1, x > 0 ? k - 1 : -1, k + N < N * N ? k + N : -1, k - N]) {
        if (j >= 0 && id[j] < 0 && inside(j)) {
          id[j] = next
          stack.push(j)
        }
      }
    }
    next++
  }
  return id
}

/** separable Gaussian that only mixes texels of the same island (normalized convolution) */
function blurIslands(src: Float32Array, island: Int32Array, N: number, sigma: number) {
  const r = Math.ceil(sigma * 3)
  const w = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)))
  const pass = (a: Float32Array, stride: number, along: (k: number) => number) => {
    const out = new Float32Array(N * N)
    for (let k = 0; k < N * N; k++) {
      const id = island[k]
      if (id < 0) continue
      const p = along(k)
      let sum = 0, ws = 0
      for (let i = -r; i <= r; i++) {
        const q = p + i
        if (q < 0 || q >= N) continue
        const j = k + i * stride
        if (island[j] !== id) continue
        sum += a[j] * w[i + r]
        ws += w[i + r]
      }
      out[k] = sum / ws
    }
    return out
  }
  const h = pass(src, 1, (k) => k % N)
  return pass(h, N, (k) => Math.floor(k / N))
}

/** texel steps to the nearest texel outside the own island, capped at `cap` */
function edgeDistance(island: Int32Array, N: number, cap: number) {
  const d = new Float32Array(N * N).fill(cap)
  let front: number[] = []
  for (let k = 0; k < N * N; k++) {
    if (island[k] < 0) continue
    const x = k % N
    const nb = [x + 1 < N ? k + 1 : -1, x > 0 ? k - 1 : -1, k + N < N * N ? k + N : -1, k - N]
    if (nb.some((j) => j < 0 || island[j] !== island[k])) {
      d[k] = 0
      front.push(k)
    }
  }
  for (let step = 1; step < cap && front.length; step++) {
    const next: number[] = []
    for (const k of front) {
      const x = k % N
      for (const j of [x + 1 < N ? k + 1 : -1, x > 0 ? k - 1 : -1, k + N < N * N ? k + N : -1, k - N]) {
        if (j >= 0 && island[j] === island[k] && d[j] > step) {
          d[j] = step
          next.push(j)
        }
      }
    }
    front = next
  }
  return d
}

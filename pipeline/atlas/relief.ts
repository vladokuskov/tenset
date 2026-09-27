// Muscle relief: a height field per texel and a separate fibre striation signal along each muscle's fibre field,
// stored as two 8-bit maps in the body UV layout. The skin shader derives normals and cavity from them.
// Bellies are Poisson domes (lap u = -1 inside the belly, 0 on its border) solved on the seam-linked texel graph, so
// they come out round, without the medial ridges of a distance field, and continuous across UV seams. Parts of one
// muscle (trapezius parts, deltoid heads, pectoral parts, ...) share one dome with a faint groove between them.
import path from 'node:path'
import { bp3dLandmarks, bpMesh, type Vec } from './bp3d.ts'
import type { RegionEntry, Segment } from './anatomy3d.ts'
import type { FigureMesh } from './figure.ts'
import { buildGraph, diffuse, prolong, solveDomes, type TexelGraph } from './graph.ts'
import { KdTree } from './kdtree.ts'
import { UNKNOWN } from './labels.ts'
import type { Texels } from './texels.ts'
import { writePng } from './webp.ts'

export const RELIEF = {
  /** boundary distance cap (mm) */
  dMax: 45,
  /** belly height = k * belly radius (2 sqrt(peak of the dome)), clamped (mm) */
  bellyK: 0.12,
  bellyMin: 1.0,
  bellyMax: 5.0,
  /** after the per-group gain */
  ampMax: 6.0,
  /** dome profile: h = amp (1 - (1 - x)^p), x = dome / peak */
  profile: 1.35,
  /** half-width of the rounded valley bottom at a belly border (mm) */
  valley: 2.0,
  /** crease between parts of one muscle that share a dome: height fraction removed at the part border, and width (mm) */
  groovePart: 0.35,
  grooveWidth: 3.4,
  /** half-width of the flat spinal furrow, and how much wider it gets between the erectors (mm) */
  furrow: 2.5,
  furrowLumbar: 3.5,
  /** half-width of the flat strip down the sternum, between the pectorals (mm) */
  sternum: 2.5,
  /** valley bottom half-width grows with the belly: max(valley, k * radius), capped (mm) */
  valleyK: 0.06,
  valleyMax: 4.0,
  /** final smoothing on the graph (mm), wider around the base of the neck */
  smoothMm: 1.3,
  neckSmoothMm: 3.2,
  /** muscles outside the region table with less visible area than this stay flat (mm²) */
  minOccluderMm2: 3000,
  /** fibre striation: wavelength and amplitude (mm) */
  fiberLambda: 4.6,
  fiberAmp: 0.055,
  quality: 94,
  fibreQuality: 70,
}

/** parts that share one dome, by BodyParts3D concept name (or our own segment keys) */
const UNIONS: [RegExp, string][] = [
  [/trapezius|rhomboid/, 'trapezius'],
  [/deltoid/, 'deltoid'],
  [/pectoralis major/, 'pectoralis'],
  [/biceps brachii/, 'biceps'],
  [/iliocostalis|longissimus|spinalis/, 'erector'],
  [/gluteus (medius|minimus)/, 'glute_med'],
  [/rectus femoris|vastus intermedius/, 'rectus_femoris'],
  [/biceps femoris/, 'biceps_femoris'],
  [/pronator teres|flexor carpi|palmaris longus|flexor digitorum superficialis/, 'forearm_flexors'],
  [/extensor carpi radialis brevis|extensor digitorum|extensor digiti minimi|extensor carpi ulnaris|abductor pollicis longus|extensor pollicis brevis/, 'forearm_extensors'],
  [/fibularis/, 'fibularis'],
  // the strips on the back of the inner thigh (matched to the 2D map) would each draw a groove
  [/semimembranosus|adductor magnus|adductor minimus|gracilis/, 'medial_thigh'],
]
/** BodyParts3D clavicles (left, right) */
const RIDGES = new Set(['FJ3237', 'FJ3362'])
/** Poisson source per part: shapes a shared dome (thick upper trapezius, thin deep parts) */
const SOURCE: [RegExp, number][] = [
  [/descending part of .*trapezius/, 2.2],
  [/transverse part of .*trapezius/, 1.0],
  [/ascending part of .*trapezius/, 0.75],
  [/rhomboid/, 0.9],
  [/vastus intermedius|gluteus minimus/, 0.6],
  [/iliocostalis/, 0.8],
  [/spinalis/, 0.9],
  [/clavicular part of .*pectoralis/, 0.75],
  [/abdominal part of .*pectoralis/, 1.2],
  [/palmaris longus|flexor carpi radialis/, 0.8],
]
/** height gain per taxonomy group: limbs read as defined as the trunk */
const GAIN: Record<string, number> = {
  forearms: 1.45, front_delt: 1.3, side_delt: 1.3, rear_delt: 1.3, calves: 1.4, tibialis: 1.3, biceps: 1.2, triceps: 1.25,
  quads: 1.1, hamstrings: 1.1, upper_traps: 1.1,
}
/** fuller domes (steeper borders) where illustrations draw limbs sharply */
const PROFILE: Record<string, number> = { calves: 1.9, forearms: 1.6, front_delt: 1.5, side_delt: 1.5, rear_delt: 1.5, triceps: 1.5, biceps: 1.5 }
/** thin sheets stay low whatever their size (mm) */
const MAX_AMP: [RegExp, number][] = [
  [/^latissimus_dorsi/, 3.6],
  [/external oblique/, 3.2],
  [/^erector/, 4.2],
  [/^trapezius/, 4.8],
  [/^pectoralis/, 4.6],
  [/gluteus maximus/, 5.0],
  [/sternocleidomastoid/, 3.0],
  [/^serratus_anterior/, 2.0],
  [/^ridge:/, 1.4],
]

type Input = {
  T: Texels
  /** mm² per texel */
  area: Float32Array
  S: Uint16Array
  L: Uint16Array
  segments: Segment[]
  regions: RegionEntry[]
  bones: Set<string>
  fig: FigureMesh
  /** parallel fibres for our own segments without a BodyParts3D mesh (concept -> direction, BodyParts3D axes) */
  fibreDir?: Map<string, Vec>
  /** seam-aware gutter sources (pad.ts) */
  padSrc: Int32Array
  log?: (s: string) => void
  debug: string | null
}

type Belly = { key: string; flat: boolean; texels: number; peak: number; amp: number; label: number; gain: number; maxAmp: number; profile: number }
type Fibre = { c: Vec; a1: Vec; a2: Vec; rRef: number; ok: boolean }

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

export function bakeRelief({ T, area, S, L, segments, regions, bones, fig, fibreDir, padSrc, log = console.log, debug }: Input) {
  const N = T.res
  const inside = (k: number) => T.tri[k] >= 0
  const landmarks = bp3dLandmarks()
  const g = buildGraph(T, area)
  const nNodes = g.texel.length
  log(`relief: graph ${nNodes} texels, ${g.seamLinks} seam links`)

  // --- bellies (domes, possibly shared by several parts) and fibre fields (one per part) ---
  const unionOf = (concept: string, side: string | null) => {
    for (const [re, u] of UNIONS) if (re.test(concept)) return `${u}:${side ?? ''}`
    return `${concept}:${side ?? ''}`
  }
  const sourceOf = (concept: string) => SOURCE.find(([re]) => re.test(concept))?.[1] ?? 1
  const bellies: Belly[] = []
  const byKey = new Map<string, number>()
  const bellyOfSeg = new Int32Array(segments.length + 1).fill(-1)
  const srcOfSeg = new Float32Array(segments.length + 1).fill(1)
  const fibreKeys: string[] = []
  const fibreOfSeg = new Int32Array(segments.length + 1).fill(-1)
  const fibreByKey = new Map<string, number>()
  const newBelly = (key: string, flat: boolean, label: number) => {
    const group = label ? regions[label - 1]?.group ?? '' : ''
    const maxAmp = MAX_AMP.find(([re]) => re.test(key))?.[1] ?? RELIEF.bellyMax
    bellies.push({ key, flat, texels: 0, peak: 0, amp: 0, label, gain: GAIN[group] ?? 1, maxAmp, profile: PROFILE[group] ?? RELIEF.profile })
    return bellies.length - 1
  }
  segments.forEach((s, i) => {
    // bones stay flat, except the clavicles: a low ridge there, so the neck doesn't sit in a crease like a collar
    const ridge = s.files.length > 0 && s.files.every((f) => RIDGES.has(f))
    const flat = !ridge && !s.side && s.files.every((f) => bones.has(f))
    const key = flat ? 'flat' : ridge ? `ridge:${s.concept}` : unionOf(s.concept, s.side)
    let b = byKey.get(key)
    if (b === undefined) {
      b = newBelly(key, flat, s.label)
      byKey.set(key, b)
    }
    bellyOfSeg[i + 1] = b
    srcOfSeg[i + 1] = sourceOf(s.concept)
    const fk = `${s.concept}:${s.side ?? ''}`
    let f = fibreByKey.get(fk)
    if (f === undefined) {
      f = fibreKeys.length
      fibreKeys.push(fk)
      fibreByKey.set(fk, f)
    }
    fibreOfSeg[i + 1] = f
  })
  const FLAT = byKey.get('flat') ?? newBelly('flat', true, 0)
  bellyOfSeg[0] = FLAT
  const B = new Int32Array(N * N).fill(-1)
  for (let k = 0; k < N * N; k++) if (inside(k)) B[k] = S[k] === UNKNOWN ? FLAT : bellyOfSeg[S[k]]
  // spinal furrow: a flat strip on the back midline, wider between the erectors
  for (let k = 0; k < N * N; k++) {
    if (B[k] < 0) continue
    const x = T.skin[k * 3], y = T.skin[k * 3 + 1], z = T.skin[k * 3 + 2]
    if (y > 0 && z > 880 && z < 1420 && Math.abs(x) < RELIEF.furrow + RELIEF.furrowLumbar * smoothstep(1160, 1040, z)) B[k] = FLAT
    if (y < 0 && z > 1170 && z < 1335 && Math.abs(x) < RELIEF.sternum) B[k] = FLAT
  }
  // muscles outside the region table: only large ones get relief (small ones would only add clutter), and none on
  // the front of the neck, where the strap muscles would draw a crease down the throat
  const bellyArea = new Float64Array(bellies.length)
  const bellyZ = new Float64Array(bellies.length)
  const bellyX = new Float64Array(bellies.length)
  for (let k = 0; k < N * N; k++) if (B[k] >= 0) {
    bellyArea[B[k]] += area[k]
    bellyZ[B[k]] += area[k] * T.skin[k * 3 + 2]
    bellyX[B[k]] += area[k] * Math.abs(T.skin[k * 3])
  }
  const occluders: string[] = []
  bellies.forEach((b, i) => {
    if (b.flat || b.label !== 0 || b.key.startsWith('ridge:')) return
    const z = bellyZ[i] / bellyArea[i], x = bellyX[i] / bellyArea[i]
    if (bellyArea[i] < RELIEF.minOccluderMm2 || (z > 1300 && x < 45)) b.flat = true
    else occluders.push(`${b.key} ${Math.round(bellyArea[i])}`)
  })
  log(`relief: occluder bellies kept: ${occluders.join(', ')}`)
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

  // --- border points (midpoints of graph edges, seam links included): between bellies, and between parts of one belly ---
  const bp: number[] = [], bn: number[] = [], pairA: number[] = [], pairB: number[] = []
  const pp: number[] = [], pn: number[] = [], partA: number[] = []
  const labelAt = (k: number) => (S[k] === UNKNOWN || S[k] === 0 ? L[k] : segments[S[k] - 1].label)
  for (let i = 0; i < nNodes; i++) {
    const k = g.texel[i]
    for (let e = g.start[i]; e < g.start[i + 1]; e++) {
      const j = g.texel[g.nb[e]]
      if (j <= k) continue
      const gap = Math.hypot(T.rest[k * 3] - T.rest[j * 3], T.rest[k * 3 + 1] - T.rest[j * 3 + 1], T.rest[k * 3 + 2] - T.rest[j * 3 + 2])
      if (gap > 6) continue
      if (B[j] !== B[k]) {
        for (let q = 0; q < 3; q++) {
          bp.push((T.rest[k * 3 + q] + T.rest[j * 3 + q]) / 2)
          bn.push(restN[k * 3 + q] + restN[j * 3 + q])
        }
        pairA.push(B[k])
        pairB.push(B[j])
      } else if (!bellies[B[k]].flat && labelAt(k) !== labelAt(j)) {
        for (let q = 0; q < 3; q++) {
          pp.push((T.rest[k * 3 + q] + T.rest[j * 3 + q]) / 2)
          pn.push(restN[k * 3 + q] + restN[j * 3 + q])
        }
        partA.push(B[k])
      }
    }
  }
  const tree = new KdTree(Float32Array.from(bp))
  const partTree = pp.length ? new KdTree(Float32Array.from(pp)) : null

  // distance to the own belly's border (fibre fade, dome start) and to a part border inside it (crease)
  const D = new Float32Array(N * N).fill(RELIEF.dMax)
  const DP = new Float32Array(N * N).fill(RELIEF.dMax)
  for (let k = 0; k < N * N; k++) {
    const b = B[k]
    if (b < 0 || bellies[b].flat) continue
    const nx = restN[k * 3], ny = restN[k * 3 + 1], nz = restN[k * 3 + 2]
    const px = T.rest[k * 3], py = T.rest[k * 3 + 1], pz = T.rest[k * 3 + 2]
    const r = tree.nearest(px, py, pz, RELIEF.dMax, (i) =>
      (pairA[i] === b || pairB[i] === b) && bn[i * 3] * nx + bn[i * 3 + 1] * ny + bn[i * 3 + 2] * nz > 0.6)
    if (r) D[k] = r[1]
    if (partTree) {
      const q = partTree.nearest(px, py, pz, 12, (i) => partA[i] === b && pn[i * 3] * nx + pn[i * 3 + 1] * ny + pn[i * 3 + 2] * nz > 0.6)
      if (q) DP[k] = q[1]
    }
  }

  // --- domes: cascadic solve, coarse levels first (a coarse node takes the belly of its texel) ---
  const radius0 = new Float32Array(bellies.length)
  {
    const ds: number[][] = bellies.map(() => [])
    for (let i = 0; i < nNodes; i += 3) {
      const b = B[g.texel[i]]
      if (b >= 0 && !bellies[b].flat) ds[b].push(D[g.texel[i]])
    }
    ds.forEach((d, b) => {
      d.sort((x, y) => x - y)
      radius0[b] = Math.max(4, d[Math.floor(d.length * 0.97)] ?? 4)
    })
  }
  const t0 = Date.now()
  const setup = (gl: TexelGraph) => {
    const n = gl.texel.length
    const region = new Int32Array(n), src = new Float32Array(n), uu = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const k = gl.texel[i]
      const b = B[k]
      if (b < 0 || bellies[b].flat) continue
      region[i] = b + 1
      // lap u = -src in mm: the graph weights are 1 / d², so the source is per unit area
      src[i] = S[k] === UNKNOWN ? 1 : srcOfSeg[S[k]]
      const d = Math.min(D[k], radius0[b])
      uu[i] = (d * (2 * radius0[b] - d)) / 4
    }
    return { g: gl, region, src, u: uu }
  }
  let prev: ReturnType<typeof setup> | null = null
  for (const [stride, sweeps] of [[4, 2500], [2, 500], [1, 250]]) {
    const lv = setup(stride === 1 ? g : buildGraph(T, area, stride))
    if (prev) prolong(prev.g, prev.u, prev.region, lv.g, lv.u, lv.region, N)
    log(`relief: dome level 1/${stride}, ${lv.g.texel.length} nodes`)
    solveDomes(lv.g, lv.region, lv.src, lv.u, { iterations: sweeps, omega: stride === 4 ? 1.95 : 1.8, log })
    prev = lv
  }
  const { region, u } = prev!
  log(`relief: domes solved in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  {
    const us: number[][] = bellies.map(() => [])
    for (let i = 0; i < nNodes; i++) if (region[i] > 0) us[region[i] - 1].push(u[i])
    us.forEach((v, b) => {
      const belly = bellies[b]
      belly.texels = v.length
      if (!v.length || belly.flat) return
      v.sort((x, y) => x - y)
      belly.peak = Math.max(1e-3, v[Math.floor(v.length * 0.995)])
      const r = 2 * Math.sqrt(belly.peak)
      belly.amp = Math.min(RELIEF.ampMax, Math.min(belly.maxAmp, Math.max(RELIEF.bellyMin, RELIEF.bellyK * r)) * belly.gain)
    })
  }

  // --- fibre fields: stripes are level sets of the angle around a convergence point c, in the plane (a1, a2) ---
  const fibres: Fibre[] = fibreKeys.map(() => ({ c: [0, 0, 0], a1: [1, 0, 0], a2: [0, 1, 0], rRef: 1, ok: false }))
  {
    const navg: Vec[] = fibres.map(() => [0, 0, 0])
    const sAvg: Vec[] = fibres.map(() => [0, 0, 0])
    const cnt = new Float64Array(fibres.length)
    for (let k = 0; k < N * N; k++) {
      if (B[k] < 0 || bellies[B[k]].flat || S[k] === UNKNOWN) continue
      const f = fibreOfSeg[S[k]]
      if (f < 0) continue
      cnt[f]++
      for (let q = 0; q < 3; q++) {
        navg[f][q] += T.skinN[k * 3 + q]
        sAvg[f][q] += T.skin[k * 3 + q]
      }
    }
    const segOfFibre = new Map<number, Segment>()
    segments.forEach((s, i) => {
      if (!segOfFibre.has(fibreOfSeg[i + 1])) segOfFibre.set(fibreOfSeg[i + 1], s)
    })
    fibres.forEach((fib, f) => {
      if (!cnt[f]) return
      const n = norm(navg[f])
      const centroid = scale(sAvg[f], 1 / cnt[f])
      const seg = segOfFibre.get(f)!
      let c: Vec
      const dir = fibreDir?.get(seg.concept)
      if (dir) c = add(centroid, scale(dir, 5000))
      else if (seg.key.startsWith('rectus_abdominis')) c = add(centroid, [0, 0, 5000])
      else if (seg.key.startsWith('latissimus_dorsi')) c = landmarks[`upperarm01_${seg.side === 'l' ? 'L' : 'R'}`]
      else if (!seg.files.length) return
      else {
        const pts = concat(seg.files.map((file) => bpMesh(file).positions))
        const pc = pca(pts)
        const e1 = pc.e1
        let tmin = Infinity, tmax = -Infinity
        for (let i = 0; i < pts.length; i += 3) {
          const t = dot(sub([pts[i], pts[i + 1], pts[i + 2]], pc.c), e1)
          tmin = Math.min(tmin, t)
          tmax = Math.max(tmax, t)
        }
        const len = tmax - tmin
        // taper: spread near each end of the axis decides where fibres converge
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
        const lo = spread(tmin, tmin + 0.18 * len), hi = spread(tmax - 0.18 * len, tmax)
        const narrow = lo.w < hi.w ? lo : hi, wide = lo.w < hi.w ? hi : lo
        const uu = norm(sub(narrow.cen, wide.cen))
        const ratio = wide.w / Math.max(1e-3, narrow.w)
        const beyond = ratio > 1.5 ? Math.min(5000, (len * narrow.w) / Math.max(1e-3, wide.w - narrow.w)) : 5000
        c = add(narrow.cen, scale(uu, beyond))
      }
      const toC = sub(centroid, c)
      fib.c = c
      fib.a1 = norm(sub(toC, scale(n, dot(toC, n))))
      fib.a2 = cross(n, fib.a1)
      fib.rRef = Math.hypot(...sub(centroid, c))
      fib.ok = true
    })
  }

  // hands (wrist and finger bones) stay smooth; the mask is diffused so it fades over a few millimetres
  const handMask = new Float32Array(nNodes)
  for (let i = 0; i < nNodes; i++) {
    const k = g.texel[i], t = T.tri[k]
    const l0 = T.bary[k * 2], l1 = T.bary[k * 2 + 1], l2 = 1 - l0 - l1
    const v = I[t * 3 + (l0 >= l1 && l0 >= l2 ? 0 : l1 >= l2 ? 1 : 2)]
    handMask[i] = /^(wrist|metacarpal|finger)/.test(fig.bone[v]) ? 0 : 1
  }
  const hand = diffuse(g, handMask, 40, 0.8)

  // --- height field ---
  const hNode = new Float32Array(nNodes)
  const fibre = new Float32Array(N * N)
  for (let i = 0; i < nNodes; i++) {
    const k = g.texel[i]
    const b = B[k]
    if (b < 0 || bellies[b].flat) continue
    const s: Vec = [T.skin[k * 3], T.skin[k * 3 + 1], T.skin[k * 3 + 2]]
    const mask = reliefMask(s) * smoothstep(0.35, 0.9, hand[i])
    if (!mask) continue
    const belly = bellies[b]
    const r = 2 * Math.sqrt(belly.peak)
    const x = Math.min(1, Math.max(0, u[i] / belly.peak))
    // soft floor, so the valley between two domes has a round bottom about `valley` wide
    const e = (2 * Math.min(RELIEF.valleyMax, Math.max(RELIEF.valley, RELIEF.valleyK * r))) / r
    const xs = (Math.sqrt(x * x + e * e) - e) / (Math.sqrt(1 + e * e) - e)
    let h = belly.amp * (1 - Math.pow(1 - xs, belly.profile))
    const d = D[k]
    // parts of one dome: a soft crease that never goes below the skin (negative heights read as cavities in the shader)
    h *= 1 - RELIEF.groovePart * Math.exp(-((DP[k] / RELIEF.grooveWidth) ** 2))
    hNode[i] = h * mask
    const f = S[k] === UNKNOWN ? -1 : fibreOfSeg[S[k]]
    const fib = f >= 0 && !belly.key.startsWith('ridge:') ? fibres[f] : null
    if (!fib?.ok) continue
    // fibres: level sets of the angle around the convergence point, warped a little so they read organic
    const rel = sub(s, fib.c)
    const theta = Math.atan2(dot(rel, fib.a2), dot(rel, fib.a1))
    const w1 = noise3(s[0] / 22, s[1] / 22, s[2] / 22) - 0.5
    const w2 = noise3(s[0] / 7 + 31, s[1] / 7, s[2] / 7) - 0.5
    const phase = (theta * fib.rRef) / RELIEF.fiberLambda + 0.9 * w1 + 0.25 * w2
    const fb = 0.72 * Math.sin(2 * Math.PI * phase) + 0.28 * Math.sin(2 * Math.PI * (phase * 2.07 + 0.4 * w1))
    const ampMod = 0.55 + 0.9 * noise3(s[0] / 14 + 7, s[1] / 14, s[2] / 14)
    fibre[k] = RELIEF.fiberAmp * fb * ampMod * smoothstep(1, 4, Math.min(d, DP[k] + 1)) * mask
  }
  let hsum = 0
  for (let i = 0; i < nNodes; i += 5) hsum += Math.sqrt(area[g.texel[i]])
  const texelMm = hsum / Math.ceil(nNodes / 5)
  const steps = Math.max(1, Math.round((2 * (RELIEF.smoothMm / texelMm) ** 2) / 0.8))
  let hs = diffuse(g, hNode, steps, 0.8)
  // the base of the neck, where the shoulder and chest domes meet the bare neck, gets a wider smoothing: a sharp
  // valley there reads as a collar
  const neckMask = new Float32Array(nNodes)
  for (let i = 0; i < nNodes; i++) {
    const z = T.skin[g.texel[i] * 3 + 2]
    neckMask[i] = smoothstep(1275, 1305, z) * smoothstep(1440, 1405, z)
  }
  hs = diffuse(g, hs, Math.round((2 * (RELIEF.neckSmoothMm / texelMm) ** 2) / 0.8), 0.8, neckMask)
  const Hh = new Float32Array(N * N)
  for (let i = 0; i < nNodes; i++) Hh[g.texel[i]] = hs[i]

  let dumps: Record<string, Float32Array> = {}
  // --- 8-bit height, padded past island borders so the shader's finite differences never read empty texels ---
  let hmin = Infinity, hmax = -Infinity
  for (let k = 0; k < N * N; k++) if (inside(k)) {
    hmin = Math.min(hmin, Hh[k])
    hmax = Math.max(hmax, Hh[k])
  }
  hmin = Math.floor(hmin * 10) / 10
  hmax = Math.ceil(hmax * 10) / 10
  const field = Hh.slice()
  const zero = Math.round((-hmin / (hmax - hmin)) * 255)
  const height = new Uint8Array(N * N * 4)
  for (let k = 0; k < N * N; k++) {
    const j = padSrc[k]
    const v = j >= 0 ? Math.max(0, Math.min(255, Math.round(((Hh[j] - hmin) / (hmax - hmin)) * 255))) : zero
    height.set([v, v, v, 255], k * 4)
  }
  if (debug) {
    writePng(path.join(debug, 'atlas-uv-height.png'), N, N, height)
    const U = new Float32Array(N * N)
    for (let i = 0; i < nNodes; i++) U[g.texel[i]] = region[i] > 0 ? u[i] / bellies[region[i] - 1].peak : 0
    dumps = { D, DP, U }
  }

  // fibres get their own 8-bit channel (128 = flat), so they keep full precision next to the smooth bellies
  const fMax = RELIEF.fiberAmp * 1.45
  const fib = new Float32Array(N * N)
  for (let k = 0; k < N * N; k++) if (padSrc[k] >= 0) fib[k] = fibre[padSrc[k]]
  const fibreTex = new Uint8Array(N * N * 4)
  for (let k = 0; k < N * N; k++) {
    const v = Math.max(0, Math.min(255, Math.round(128 + (fib[k] / fMax) * 127)))
    fibreTex.set([v, v, v, 255], k * 4)
  }
  const amps = bellies.filter((b) => !b.flat && b.texels && b.key.endsWith(':l')).map((b) => `${b.key.replace(/:l$/, '').replace(/^left |(of )?left /, '')} ${b.amp.toFixed(1)}`)
  log(`relief: ${amps.length} bellies per side, amplitudes (mm): ${amps.join(', ')}`)
  return { res: N, field, dumps, height, fibre: fibreTex, fibreMm: fMax, fibreQuality: RELIEF.fibreQuality, minMm: hmin, maxMm: hmax, quality: RELIEF.quality, bellies: bellies.length, boundaryPoints: pairA.length }
}

/** Relief fades out on the face and feet (BodyParts3D millimetres); hands are masked by their bones. */
function reliefMask(s: Vec) {
  const z = s[2]
  return smoothstep(1505, 1455, z) * smoothstep(55, 95, z)
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

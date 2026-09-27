// Label refinements for the illustration look, applied after the projected labels are cleaned (bake.ts).
// Positions are BodyParts3D millimetres of each texel's skin point (x left, y posterior, z up) unless noted.
//   wrists     bare tendon wedges on the distal forearm join the forearm groups; the groups end on a clean ring
//   sternum    the bare notch between the pectorals under the sternal notch closes (they meet on the midline)
//   brachialis no higher up the arm than on the 2D map
//   adductors  the posterior-medial thigh follows the 2D map's back view (adductor magnus, gracilis, semimembranosus)
//   flank      serratus anterior digitations interlocking with the external oblique: our own shapes, as for the
//              latissimus dorsi and rectus abdominis, since the projected slips come out ragged
//   neck       wider majority filter, so the sternocleidomastoid and trapezius borders run smooth
//   trapClip   the upper trapezius above a line on the neck moves to its own illustration-clip region
import type { RegionEntry, Segment } from './anatomy3d.ts'
import type { Vec } from './bp3d.ts'
import { alignFigure } from './align.ts'
import type { FigureMesh } from './figure.ts'
import { dropSpecks, fillUnknown, modeFilter, UNKNOWN } from './labels.ts'
import { frame, H, MARGIN, svgLabels, type MapRegion } from './map2d.ts'
import type { Texels } from './texels.ts'

type Side = 'l' | 'r'
const SIDES: Side[] = ['l', 'r']

export const FLANK = {
  /** interdigitation base line, anterior-superior to posterior-inferior, (y, z) */
  p0: [-192, 1172] as [number, number],
  p1: [-66, 1082] as [number, number],
  slips: 4,
  /** slip direction into the oblique, (y, z), unit */
  dir: [-0.6, -0.8] as [number, number],
  /** digitation radius, how far the tips reach past the base line and how far the oblique's slips reach above it (mm) */
  radius: 13,
  tip: 0.45,
  reach: 32,
  top: 0,
  /** serratus stops this far above the base line (the axilla above it is bare skin) */
  ceiling: 58,
  /** smooth union radius, rounds the oblique's slip tips (mm) */
  round: 6,
}
/** upper-trapezius highlight stops at z = base + rise * smoothstep(y0, y1, y) on the neck (mm) */
const TRAP_CLIP = { base: 1398, rise: 27, y0: -75, y1: -5 }
const WRIST_END_MM = 9

export function refineLabels(T: Texels, L: Uint16Array, area: Float32Array, fig: FigureMesh, regions: RegionEntry[]) {
  const N = T.res
  const inside = (k: number) => T.tri[k] >= 0
  const idx = (id: string, side: Side) => {
    const i = regions.findIndex((r) => r.id === id && r.side === side)
    if (i < 0) throw new Error(`no region ${id}:${side}`)
    return i + 1
  }
  const log: string[] = []
  const bone = (k: number) => {
    const t = T.tri[k], l0 = T.bary[k * 2], l1 = T.bary[k * 2 + 1], l2 = 1 - l0 - l1
    return fig.bone[fig.indices[t * 3 + (l0 >= l1 && l0 >= l2 ? 0 : l1 >= l2 ? 1 : 2)]]
  }
  const X = (k: number) => T.skin[k * 3], Y = (k: number) => T.skin[k * 3 + 1], Z = (k: number) => T.skin[k * 3 + 2]
  const sideOf = (k: number): Side => (X(k) >= 0 ? 'l' : 'r')

  /** UNKNOWN texels take the most common allowed neighbour label, repeatedly; leftovers become `rest` */
  const fillFrom = (allowed: (k: number, v: number) => boolean, rest = 0) => {
    let todo: number[] = []
    for (let k = 0; k < N * N; k++) if (L[k] === UNKNOWN && inside(k)) todo.push(k)
    const counts = new Map<number, number>()
    for (let it = 0; it < 300 && todo.length; it++) {
      const next: number[] = [], set: [number, number][] = []
      for (const k of todo) {
        const x = k % N, y = (k - x) / N
        counts.clear()
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy
          if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= N || yy >= N) continue
          const v = L[yy * N + xx]
          if (v !== UNKNOWN && inside(yy * N + xx) && allowed(k, v)) counts.set(v, (counts.get(v) ?? 0) + 1)
        }
        let best = -1, bc = 0
        for (const [v, c] of counts) if (c > bc) { best = v; bc = c }
        if (best >= 0) set.push([k, best])
        else next.push(k)
      }
      for (const [k, v] of set) L[k] = v
      todo = next
    }
    for (const k of todo) L[k] = rest
    return todo.length
  }

  // --- wrists (figure rest space: forearm axis from the elbow to the wrist joint) ---
  {
    const J = fig.pose('rest').joints
    let changed = 0
    for (const side of SIDES) {
      const S = side === 'l' ? 'L' : 'R'
      const E = J[`lowerarm01_${S}`].map((v) => v * 1000), W = J[`wrist_${S}`].map((v) => v * 1000)
      const len = Math.hypot(W[0] - E[0], W[1] - E[1], W[2] - E[2])
      const a = [0, 1, 2].map((q) => (W[q] - E[q]) / len)
      const fore = new Set(['brachioradialis', 'wrist_flexors', 'wrist_extensors'].map((id) => idx(id, side)))
      const re = new RegExp(`^(lowerarm0[12]|wrist|metacarpal\\d|finger\\d-\\d)_${S}$`)
      const tEnd = 1 - WRIST_END_MM / len
      for (let k = 0; k < N * N; k++) {
        if (!inside(k) || !re.test(bone(k))) continue
        const t = ((T.rest[k * 3] - E[0]) * a[0] + (T.rest[k * 3 + 1] - E[1]) * a[1] + (T.rest[k * 3 + 2] - E[2]) * a[2]) / len
        if (t > tEnd) {
          if (fore.has(L[k])) { L[k] = 0; changed++ }
        } else if (t > 0.45 && L[k] === 0) {
          L[k] = UNKNOWN
          changed++
        }
      }
      fillFrom((_, v) => fore.has(v))
    }
    log.push(`wrists: ${changed} texels`)
  }

  // --- sternum: the pectorals meet on the midline up to just under the sternal notch ---
  {
    let changed = 0
    const pecs = new Map(SIDES.map((s) => [s, new Set([idx('pec_sternal', s), idx('pec_clavicular', s)])]))
    for (let k = 0; k < N * N; k++) {
      if (!inside(k) || L[k] !== 0) continue
      if (Math.abs(X(k)) < 14 && T.skinN[k * 3 + 1] < -0.5 && Z(k) > 1262 && Z(k) < 1318) {
        L[k] = UNKNOWN
        changed++
      }
    }
    fillFrom((k, v) => pecs.get(sideOf(k))!.has(v))
    log.push(`sternum: ${changed} texels`)
  }

  // --- 2D map: brachialis extent (front) and the adductor strips (back) ---
  {
    const fr = frame()
    const W = fr.W
    const table: MapRegion[] = regions.map((r, i) => ({ index: i + 1, head: r.untracked ? null : r.id, untracked: r.untracked ? r.id : undefined, side: r.side }))
    const zOf = (py: number) => fr.zMax - (py + 0.5 - MARGIN) / fr.scale
    const front = svgLabels('F', W, table).L
    let clipped = 0
    for (const side of SIDES) {
      const br = idx('brachialis', side)
      let top = H
      for (let p = 0; p < W * H; p++) if (front[p] === br) top = Math.min(top, Math.floor(p / W))
      const zTop = zOf(top) + 4
      for (let k = 0; k < N * N; k++) if (inside(k) && L[k] === br && Z(k) > zTop) {
        L[k] = UNKNOWN
        clipped++
      }
      fillFrom((_, v) => v !== br && v !== 0)
    }
    log.push(`brachialis: ${clipped} texels above the 2D map's top`)

    // back view of the aligned body, exactly as validate.ts renders it: a texel follows the 2D map where it is visible
    const back = svgLabels('B', W, table).L
    const { mapped } = alignFigure(fig)
    const I = fig.indices
    const proj = new Float32Array(mapped.length)
    for (let i = 0; i < mapped.length; i += 3) {
      proj[i] = W / 2 - mapped[i] * fr.scale
      proj[i + 1] = MARGIN + (fr.zMax - mapped[i + 2]) * fr.scale
      proj[i + 2] = -mapped[i + 1]
    }
    const depth = new Float32Array(W * H).fill(Infinity)
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3
      const ax = proj[a], ay = proj[a + 1], bx = proj[b], by = proj[b + 1], cx = proj[c], cy = proj[c + 1]
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
      if (Math.abs(det) < 1e-9) continue
      for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy))); y <= Math.min(H - 1, Math.ceil(Math.max(ay, by, cy))); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx))); x <= Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx))); x++) {
          const l0 = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / det
          const l1 = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / det
          if (l0 < 0 || l1 < 0 || l0 + l1 > 1) continue
          const d = l0 * proj[a + 2] + l1 * proj[b + 2] + (1 - l0 - l1) * proj[c + 2]
          if (d < depth[y * W + x]) depth[y * W + x] = d
        }
      }
    }
    let moved = 0
    for (const side of SIDES) {
      const S = side === 'l' ? 'L' : 'R'
      const re = new RegExp(`^(upperleg0[12]|lowerleg01|pelvis)_${S}$`)
      const am = idx('adductor_magnus', side), al = idx('adductor_longus', side)
      const ham = new Set([idx('semimembranosus', side), idx('semitendinosus', side)])
      const set = new Set([am, al, ...ham])
      for (let k = 0; k < N * N; k++) {
        if (!inside(k) || !set.has(L[k]) || !re.test(bone(k))) continue
        const t = T.tri[k], l0 = T.bary[k * 2], l1 = T.bary[k * 2 + 1], l2 = 1 - l0 - l1
        const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3
        const px = Math.floor(l0 * proj[a] + l1 * proj[b] + l2 * proj[c]), py = Math.floor(l0 * proj[a + 1] + l1 * proj[b + 1] + l2 * proj[c + 1])
        if (px < 0 || py < 0 || px >= W || py >= H) continue
        if (l0 * proj[a + 2] + l1 * proj[b + 2] + l2 * proj[c + 2] > depth[py * W + px] + 3) continue
        const v = L[k], m = back[py * W + px]
        // an adductor texel where the map shows another thigh muscle takes it too (stray adductor on the hamstrings)
        const other = v === am && m > 0 && m !== v && regions[m - 1].side === side && /hamstrings|quads|glute/.test(regions[m - 1].group ?? '')
        if (other || (set.has(m) && m !== v)) {
          L[k] = m
          moved++
        }
      }
    }
    // the map is a raster: smooth the stair steps it leaves on the strip borders
    const thigh = (k: number) => inside(k) && /^(upperleg0[12]|lowerleg01|pelvis)_/.test(bone(k)) && T.skinN[k * 3 + 1] > -0.2
    modeFilter(L, thigh, N, 5, 3)
    log.push(`adductors: ${moved} posterior thigh texels follow the 2D back view`)
  }

  // --- arm muscles stop at the armpit: on the chest wall they streak in overhead poses ---
  {
    const arm = new Set(SIDES.flatMap((sd) => ['biceps_brachii', 'brachialis', 'triceps_long', 'triceps_lateral', 'brachioradialis', 'wrist_flexors', 'wrist_extensors'].map((id) => idx(id, sd))))
    let n = 0
    for (let k = 0; k < N * N; k++) if (inside(k) && arm.has(L[k]) && /^(spine|neck|pelvis|root)/.test(bone(k))) {
      L[k] = UNKNOWN
      n++
    }
    fillFrom((_, v) => !arm.has(v))
    log.push(`arm muscles off the trunk: ${n} texels`)
  }

  // --- flank: serratus digitations and the oblique's slips between them ---
  const segments: Segment[] = []
  const fibreDir = new Map<string, Vec>()
  const fingerOf = new Int32Array(N * N).fill(-1)
  {
    const F = FLANK
    const d = [F.p1[0] - F.p0[0], F.p1[1] - F.p0[1]]
    const len = Math.hypot(d[0], d[1])
    const du = [d[0] / len, d[1] / len]
    const nu = [-du[1], du[0]]
    if (nu[1] < 0) { nu[0] = -nu[0]; nu[1] = -nu[1] }
    const fd = F.dir
    const fn = fd[0] * nu[0] + fd[1] * nu[1]
    const spacing = len / F.slips
    const root = F.top + 8
    const segLen = (root - (-F.reach + F.radius)) / -fn
    const caps = Array.from({ length: F.slips }, (_, i) => {
      const a = (i + 0.5) * spacing
      const q = [F.p0[0] + du[0] * a + nu[0] * root, F.p0[1] + du[1] * a + nu[1] * root]
      return { q, t: [q[0] + fd[0] * segLen, q[1] + fd[1] * segLen] }
    })
    const fp = [-fd[1], fd[0]]
    if (fp[0] * du[0] + fp[1] * du[1] < 0) { fp[0] = -fp[0]; fp[1] = -fp[1] }
    const axisE = caps.map((c) => (c.q[0] - F.p0[0]) * fp[0] + (c.q[1] - F.p0[1]) * fp[1])
    // tapered capsule: full radius at the root, `tip` of it at the tip
    const capDist = (p: number[], a: number[], b: number[]) => {
      const ab = [b[0] - a[0], b[1] - a[1]], ap = [p[0] - a[0], p[1] - a[1]]
      const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1])))
      return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t) - F.radius * (1 - (1 - F.tip) * t)
    }
    const smin = (a: number, b: number, k: number) => {
      const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k))
      return b + (a - b) * h - k * h * (1 - h)
    }
    const sdf = (p: number[]) => {
      const a = (p[0] - F.p0[0]) * du[0] + (p[1] - F.p0[1]) * du[1]
      const b = (p[0] - F.p0[0]) * nu[0] + (p[1] - F.p0[1]) * nu[1]
      const box = Math.max(F.top - b, -6 - a, a - (len + 40))
      let c = Infinity
      for (const cap of caps) c = Math.min(c, capDist(p, cap.q, cap.t))
      return { v: smin(box, c, F.round), a, b }
    }
    let sa = 0, eo = 0
    for (const side of SIDES) {
      const SA = idx('serratus_anterior', side), EO = idx('external_oblique', side)
      const segBase = segments.length
      for (let i = 0; i < F.slips; i++) {
        const concept = `serratus_anterior:${side}:slip${i}`
        segments.push({ key: concept, concept, label: SA, side, files: [] })
        fibreDir.set(concept, [0, fd[0], fd[1]])
      }
      for (let k = 0; k < N * N; k++) {
        if (!inside(k) || sideOf(k) !== side) continue
        const v = L[k]
        if (v !== SA && v !== EO && v !== 0) continue
        if (Z(k) < 1000 || Z(k) > 1265 || Math.abs(T.skinN[k * 3]) < 0.1 || /arm|clavicle|shoulder/.test(bone(k))) continue
        const p = [Y(k), Z(k)]
        const s = sdf(p)
        if (s.a < -40 || s.a > len + 60 || s.b < -70 || s.b > 110) continue
        if (s.v < 0 && s.b > F.ceiling) {
          if (v === SA) L[k] = 0
        } else if (s.v < 0) {
          if (v !== SA) sa++
          L[k] = SA
        } else if (v === SA || (v === 0 && s.b < 40)) {
          L[k] = EO
          eo++
        }
      }
      // latissimus pieces cut off inside the flank (hand polygon corners) take the design's label
      const LD = idx('latissimus_dorsi', side)
      const seen = new Uint8Array(N * N)
      for (let s0 = 0; s0 < N * N; s0++) {
        if (seen[s0] || !inside(s0) || L[s0] !== LD || sideOf(s0) !== side || Z(s0) < 1000 || Z(s0) > 1265) continue
        const piece = [s0]
        seen[s0] = 1
        let ar = 0
        for (let i = 0; i < piece.length; i++) {
          const k = piece[i]
          ar += area[k]
          const x = k % N, y = (k - x) / N
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const j = (y + dy) * N + x + dx
            if (x + dx < 0 || y + dy < 0 || x + dx >= N || y + dy >= N || seen[j] || !inside(j) || L[j] !== LD) continue
            seen[j] = 1
            piece.push(j)
          }
        }
        if (ar < 1500) for (const k of piece) L[k] = sdf([Y(k), Z(k)]).v < 0 ? SA : EO
      }
      // every serratus texel joins the slip band it lies in (bands run along the slips, grooves between them)
      for (let k = 0; k < N * N; k++) {
        if (!inside(k) || L[k] !== SA) continue
        const e = (Y(k) - F.p0[0]) * fp[0] + (Z(k) - F.p0[1]) * fp[1]
        let best = 0
        for (let i = 1; i < F.slips; i++) if (Math.abs(e - axisE[i]) < Math.abs(e - axisE[best])) best = i
        fingerOf[k] = segBase + best
      }
    }
    log.push(`flank: ${sa} texels to serratus, ${eo} to the oblique`)
  }

  // --- neck borders ---
  {
    const neck = (k: number) => inside(k) && Z(k) > 1310 && Z(k) < 1510
    modeFilter(L, neck, N, 6, 3)
    dropSpecks(L, inside, area, N, (v) => (v === 0 ? 60 : 150))
    fillUnknown(L, inside, N)
  }
  return { segments, fibreDir, fingerOf, log }
}

/** Upper trapezius above the neck line -> its clip region (same muscle, drawn without highlight). */
export function clipTrapezius(T: Texels, L: Uint16Array, regions: RegionEntry[], clipIndex: (side: Side) => number) {
  const N = T.res
  let n = 0
  for (const side of SIDES) {
    const tu = regions.findIndex((r) => r.id === 'trap_upper' && r.side === side) + 1
    const clip = clipIndex(side)
    for (let k = 0; k < N * N; k++) {
      if (T.tri[k] < 0 || L[k] !== tu) continue
      const y = T.skin[k * 3 + 1], z = T.skin[k * 3 + 2]
      const t = Math.min(1, Math.max(0, (y - TRAP_CLIP.y0) / (TRAP_CLIP.y1 - TRAP_CLIP.y0)))
      if (z > TRAP_CLIP.base + TRAP_CLIP.rise * t * t * (3 - 2 * t)) {
        L[k] = clip
        n++
      }
    }
  }
  return n
}

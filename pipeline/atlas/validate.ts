// Atlas validation against the 2D body map: the aligned body (anatomical pose, landmark TPS into BodyParts3D
// millimetres) is rasterized orthographically in the 2D map's frame with the baked region texture, then compared
// head by head with the region paths of public/anatomy/{front,back}.svg (same taxonomy ids and sides).
// node pipeline/atlas/validate.ts  ->  qa/out/s1v2/atlas-overlay-{front,back}.png, atlas-validate.json
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import { PUBLIC, ROOT } from '../lib/paths.ts'
import { alignFigure } from './align.ts'
import { bpMesh, conceptFiles } from './bp3d.ts'
import { loadFigure } from './figure.ts'
import { ATLAS_CACHE } from './paths.ts'
import { writePng } from './webp.ts'

const QA = path.join(ROOT, 'qa/out/s1v2')
const H = 2048, MARGIN = 16
/** a head counts as misplaced when its centroid is further than this from the 2D map's (mm) */
const MISPLACED_MM = 35
/** 3D pixels further than this from the 2D region count as bleeding (mm) */
const BLEED_MM = 30

type View = 'F' | 'B'
type Region = { index: number; head: string | null; untracked?: string; group: string | null; side: 'l' | 'r'; views: string }

function frame() {
  const P = bpMesh(conceptFiles('skin')[0]).positions
  let zMin = Infinity, zMax = -Infinity, xAbs = 0
  for (let i = 0; i < P.length; i += 3) {
    xAbs = Math.max(xAbs, Math.abs(P[i]))
    zMin = Math.min(zMin, P[i + 2])
    zMax = Math.max(zMax, P[i + 2])
  }
  const scale = (H - 2 * MARGIN) / (zMax - zMin)
  const W = 2 * Math.ceil(xAbs * scale + MARGIN)
  return { W, scale, zMax }
}

function parsePath(d: string): [number, number][][] {
  const tok = d.match(/[MmLlHhVvZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? []
  const rings: [number, number][][] = []
  let ring: [number, number][] = []
  let x = 0, y = 0, cmd = 'M', i = 0
  const num = () => Number(tok[i++])
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++]
    if (cmd === 'Z' || cmd === 'z') {
      if (ring.length) rings.push(ring)
      ring = []
      continue
    }
    if (cmd === 'M' || cmd === 'm') {
      if (ring.length) rings.push(ring)
      ring = []
      const nx = num(), ny = num()
      x = cmd === 'm' ? x + nx : nx
      y = cmd === 'm' ? y + ny : ny
      cmd = cmd === 'm' ? 'l' : 'L'
    } else if (cmd === 'L') { x = num(); y = num() }
    else if (cmd === 'l') { x += num(); y += num() }
    else if (cmd === 'H') x = num()
    else if (cmd === 'h') x += num()
    else if (cmd === 'V') y = num()
    else if (cmd === 'v') y += num()
    else throw new Error(`unsupported path command ${cmd}`)
    ring.push([x, y])
  }
  if (ring.length) rings.push(ring)
  return rings
}

/** even-odd fill at pixel centres */
function fillRings(rings: [number, number][][], W: number, out: Uint8Array, value: number) {
  const edges: [number, number, number, number][] = []
  let y0 = Infinity, y1 = -Infinity
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length]
      if (a[1] === b[1]) continue
      edges.push([a[0], a[1], b[0], b[1]])
      y0 = Math.min(y0, a[1], b[1])
      y1 = Math.max(y1, a[1], b[1])
    }
  }
  for (let py = Math.max(0, Math.floor(y0)); py <= Math.min(H - 1, Math.ceil(y1)); py++) {
    const yc = py + 0.5
    const xs: number[] = []
    for (const [ax, ay, bx, by] of edges) if ((ay <= yc) !== (by <= yc)) xs.push(ax + ((yc - ay) * (bx - ax)) / (by - ay))
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let px = Math.max(0, Math.ceil(xs[k] - 0.5)); px <= Math.min(W - 1, Math.floor(xs[k + 1] - 0.5)); px++) out[py * W + px] = value
    }
  }
}

function svgLabels(view: View, W: number, regions: Region[]) {
  const svg = fs.readFileSync(path.join(PUBLIC, `anatomy/${view === 'F' ? 'front' : 'back'}.svg`), 'utf8')
  const L = new Uint8Array(W * H)
  const sil = new Uint8Array(W * H)
  const silD = svg.match(/<g id="silhouette"><path d="([^"]+)"/)![1]
  fillRings(parsePath(silD), W, sil, 1)
  for (const m of svg.matchAll(/<path ([^>]*?)\sd="([^"]+)"/g)) {
    const attrs = m[1]
    const id = attrs.match(/data-(?:head|untracked)="([^"]+)"/)?.[1]
    const side = attrs.match(/data-side="([lr])"/)?.[1]
    if (!id || !side) continue
    const r = regions.find((q) => (q.head ?? q.untracked) === id && q.side === side)
    if (!r) throw new Error(`svg region ${id}:${side} not in atlas.json`)
    fillRings(parsePath(m[2]), W, L, r.index)
  }
  return { L, sil }
}

/** Euclidean distance transform (two-pass chamfer 3-4, in pixels) to the set `inSet` */
function distanceTo(inSet: Uint8Array, W: number) {
  const D = new Float32Array(W * H).fill(1e9)
  for (let k = 0; k < W * H; k++) if (inSet[k]) D[k] = 0
  const step = (k: number, j: number, c: number) => {
    if (D[j] + c < D[k]) D[k] = D[j] + c
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x
    if (x > 0) step(k, k - 1, 1)
    if (y > 0) {
      step(k, k - W, 1)
      if (x > 0) step(k, k - W - 1, 1.4142)
      if (x < W - 1) step(k, k - W + 1, 1.4142)
    }
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const k = y * W + x
    if (x < W - 1) step(k, k + 1, 1)
    if (y < H - 1) {
      step(k, k + W, 1)
      if (x < W - 1) step(k, k + W + 1, 1.4142)
      if (x > 0) step(k, k + W - 1, 1.4142)
    }
  }
  return D
}

async function main() {
  const atlas = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'models/atlas.json'), 'utf8')) as { regions: Region[] }
  const regions = atlas.regions
  const png = PNG.sync.read(fs.readFileSync(path.join(ATLAS_CACHE, 'png/atlas-regions.png')))
  const TN = png.width
  const tex = new Uint8Array(TN * TN)
  for (let k = 0; k < TN * TN; k++) tex[k] = png.data[k * 4]

  const fig = await loadFigure('a')
  const { mapped } = alignFigure(fig)
  const { W, scale, zMax } = frame()
  const mmPerPx = 1 / scale
  const I = fig.indices, uv = fig.uv
  const report: Record<string, unknown> = { frame: { W, H, mmPerPx: +mmPerPx.toFixed(3) }, views: {} }
  const problems: string[] = []
  const taxonomy = new Map(regions.map((r) => [r.index, r]))

  for (const view of ['F', 'B'] as View[]) {
    const sx = view === 'F' ? 1 : -1
    const proj = new Float32Array(mapped.length)
    for (let i = 0; i < mapped.length; i += 3) {
      proj[i] = W / 2 + sx * mapped[i] * scale
      proj[i + 1] = MARGIN + (zMax - mapped[i + 2]) * scale
      proj[i + 2] = view === 'F' ? mapped[i + 1] : -mapped[i + 1]
    }
    const depth = new Float32Array(W * H).fill(Infinity)
    const L3 = new Uint8Array(W * H)
    const sil3 = new Uint8Array(W * H)
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2]
      const ax = proj[a * 3], ay = proj[a * 3 + 1], bx = proj[b * 3], by = proj[b * 3 + 1], cx = proj[c * 3], cy = proj[c * 3 + 1]
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
      if (Math.abs(det) < 1e-9) continue
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)))
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)))
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5
        const l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det
        const l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det
        const l2 = 1 - l0 - l1
        if (l0 < 0 || l1 < 0 || l2 < 0) continue
        const d = l0 * proj[a * 3 + 2] + l1 * proj[b * 3 + 2] + l2 * proj[c * 3 + 2]
        const k = y * W + x
        if (d >= depth[k]) continue
        depth[k] = d
        const u = l0 * uv[a * 2] + l1 * uv[b * 2] + l2 * uv[c * 2]
        const v = l0 * uv[a * 2 + 1] + l1 * uv[b * 2 + 1] + l2 * uv[c * 2 + 1]
        L3[k] = tex[Math.min(TN - 1, Math.floor(v * TN)) * TN + Math.min(TN - 1, Math.floor(u * TN))]
        sil3[k] = 1
      }
    }
    const { L: L2, sil: sil2 } = svgLabels(view, W, regions)
    let inter = 0, union = 0
    for (let k = 0; k < W * H; k++) {
      if (sil3[k] && sil2[k]) inter++
      if (sil3[k] || sil2[k]) union++
    }
    const heads: Record<string, unknown>[] = []
    for (const r of regions) {
      if (!r.views.includes(view)) continue
      const key = `${r.head ?? r.untracked}:${r.side}`
      const m2 = new Uint8Array(W * H), m3 = new Uint8Array(W * H)
      let n2 = 0, n3 = 0, both = 0, c2x = 0, c2y = 0, c3x = 0, c3y = 0, z2min = Infinity, z2max = -Infinity, z3min = Infinity, z3max = -Infinity
      for (let k = 0; k < W * H; k++) {
        const x = k % W, y = (k - x) / W
        if (L2[k] === r.index) { m2[k] = 1; n2++; c2x += x; c2y += y; z2min = Math.min(z2min, y); z2max = Math.max(z2max, y) }
        if (L3[k] === r.index) { m3[k] = 1; n3++; c3x += x; c3y += y; z3min = Math.min(z3min, y); z3max = Math.max(z3max, y) }
        if (L2[k] === r.index && L3[k] === r.index) both++
      }
      if (!n2 && !n3) continue
      const entry: Record<string, unknown> = { region: key, px2d: n2, px3d: n3 }
      if (!n3) {
        entry.status = 'missing'
        problems.push(`${view} ${key}: missing on the 3D body`)
        heads.push(entry)
        continue
      }
      if (!n2) {
        entry.status = 'not in 2D view'
        heads.push(entry)
        continue
      }
      const D2 = distanceTo(m2, W)
      let bleed = 0
      for (let k = 0; k < W * H; k++) if (m3[k] && D2[k] * mmPerPx > BLEED_MM) bleed++
      const off = Math.hypot(c3x / n3 - c2x / n2, c3y / n3 - c2y / n2) * mmPerPx
      Object.assign(entry, {
        areaRatio: +(n3 / n2).toFixed(2),
        iou: +(both / (n2 + n3 - both)).toFixed(2),
        centroidOffsetMm: +off.toFixed(1),
        centroidDxDzMm: [+(((c3x / n3 - c2x / n2) * mmPerPx) * sx).toFixed(1), +((-(c3y / n3 - c2y / n2)) * mmPerPx).toFixed(1)],
        bleedShare: +(bleed / n3).toFixed(3),
        extentOverTopMm: +Math.max(0, (z2min - z3min) * mmPerPx).toFixed(0),
        extentOverBottomMm: +Math.max(0, (z3max - z2max) * mmPerPx).toFixed(0),
      })
      const flags: string[] = []
      if (off > MISPLACED_MM) flags.push('misplaced')
      if (bleed / n3 > 0.08) flags.push('bleeding')
      if (n3 / n2 < 0.4) flags.push('undersized')
      entry.status = flags.length ? flags.join(',') : 'ok'
      if (flags.length) problems.push(`${view} ${key}: ${flags.join(',')} (offset ${off.toFixed(0)} mm, IoU ${(both / (n2 + n3 - both)).toFixed(2)}, area x${(n3 / n2).toFixed(2)}, bleed ${(100 * bleed / n3).toFixed(0)}%)`)
      heads.push(entry)
    }
    ;(report.views as Record<string, unknown>)[view] = { silhouetteIoU: +(inter / union).toFixed(3), heads }

    // overlay: 3D labels in the 2D palette, 2D region outlines in black, silhouette outline in grey
    const out = new Uint8Array(W * H * 4)
    const pal = (i: number): [number, number, number] => {
      const r = taxonomy.get(i)
      if (!r) return [217, 214, 208]
      if (!r.head) return [185, 180, 171]
      let h = 2166136261
      for (const ch of r.head) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
      h = h >>> 0
      const s = 55 + ((h >> 9) % 30), l = 48 + ((h >> 17) % 18), hue = h % 360
      const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
      const f = (n: number) => {
        const q = (n + hue / 30) % 12
        return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(q - 3, 9 - q, 1))))
      }
      return [f(0), f(8), f(4)]
    }
    for (let k = 0; k < W * H; k++) {
      const c = sil3[k] ? pal(L3[k]) : [255, 255, 255]
      out.set([...c, 255], k * 4)
    }
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const k = y * W + x
      const edge = (A: Uint8Array) => A[k] !== A[k + 1] || A[k] !== A[k + W]
      if (edge(L2) && (L2[k] || L2[k + 1] || L2[k + W])) out.set([0, 0, 0, 255], k * 4)
      else if (edge(sil2)) out.set([120, 120, 120, 255], k * 4)
    }
    writePng(path.join(QA, `atlas-overlay-${view === 'F' ? 'front' : 'back'}.png`), W, H, out)
  }
  report.problems = problems
  fs.writeFileSync(path.join(QA, 'atlas-validate.json'), JSON.stringify(report, null, 1))
  const v = report.views as Record<string, { silhouetteIoU: number }>
  console.log(`silhouette IoU front ${v.F.silhouetteIoU}, back ${v.B.silhouetteIoU}`)
  console.log(problems.length ? problems.join('\n') : 'no problems')
}

await main()

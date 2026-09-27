// Bakes the front/back head-level body map from BodyParts3D 4.0 (CC BY 4.0).
// Usage: node pipeline/anatomy/bake-map.ts [--debug]
// Needs pipeline/.cache/bodyparts3d/isa_BP3D_4.0_obj_99/ (see pipeline/anatomy/README.md).
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import { CACHE, DATA, PUBLIC, ROOT } from '../lib/paths.ts'
import { loadObj, type Mesh } from '../lib/obj.ts'
import { createTarget, drawTriangles, forEachFragment, nearFar, type Target } from '../lib/raster.ts'
import { close, components, crop, dilate, fillHoles, open } from '../lib/mask.ts'
import { traceMask, pathData, type Ring } from '../lib/trace.ts'
import { encodeIdRaster } from '../../src/domain/idRaster.ts'

const BP3D_DIR = path.join(CACHE, 'bodyparts3d/isa_BP3D_4.0_obj_99')
const OUT_DIR = path.join(PUBLIC, 'anatomy')
const QA_DIR = path.join(ROOT, 'qa/out/s2')
const DEBUG = process.argv.includes('--debug')

type Side = 'l' | 'r'
type View = 'F' | 'B'
type Line = [[number, number], [number, number]]
type Clip = { zMin?: number; zMax?: number; above?: Line; below?: Line }
type SideRef = { name: string; fma: string; files: string[] }
type Part = {
  deep?: string
  clip?: Partial<Record<View, Clip>>
  maxThicknessMm?: number
  overrides?: string[]
  l: SideRef
  r: SideRef
}
type Region = {
  id: string
  kind: 'head' | 'untracked'
  group: string | null
  views: View[]
  clip?: Partial<Record<View, Clip>>
  source: 'bodyparts3d' | 'hand-polygon'
  parts: Part[]
}
type FmaMap = { skin: SideRef; regions: Region[]; occluders: { files: string[] } }
type HandRegion = {
  view: View
  note?: string
  override?: string[] // drawn regions this polygon paints over, besides uncovered skin
  polygon: [number, number][]
  gaps?: { line: [number, number][]; widthMm: number }[]
}

const fmaMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline/anatomy/fma-map.json'), 'utf8')) as FmaMap
const handRegions = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline/anatomy/hand-regions.json'), 'utf8')) as Record<string, HandRegion>
const taxonomy = JSON.parse(fs.readFileSync(path.join(DATA, 'taxonomy.json'), 'utf8')) as {
  groups: { id: string; banded: boolean }[]
}

const NONE = 0
const NEUTRAL = 1
const H = 2048
const MARGIN = 16
const OPEN_RADIUS = 2
const MIN_PIECE = 0.0005 // of body area
const TOLERANCE = 0.6 // px at 2048, full map
const BLUR = 2 // px, rounds off mesh facets and pixel steps before tracing
const GROUP_TOLERANCE = 2.6 // px, mini map
const RASTER_H = 480
const CREDIT = '<!--! BodyParts3D, © The Database Center for Life Science, CC BY 4.0, modified -->'

const meshCache = new Map<string, Mesh>()
function mesh(file: string): Mesh {
  let m = meshCache.get(file)
  if (!m) {
    const p = path.join(BP3D_DIR, `${file}.obj`)
    if (!fs.existsSync(p)) throw new Error(`missing ${p}; unzip isa_BP3D_4.0_obj_99.zip into ${path.dirname(BP3D_DIR)}`)
    m = loadObj(p)
    meshCache.set(file, m)
  }
  return m
}

// One frame for both views so front.svg and back.svg share the viewBox.
const skin = mesh(fmaMap.skin.files[0])
let zMin = Infinity, zMax = -Infinity, xAbs = 0
for (let i = 0; i < skin.positions.length; i += 3) {
  xAbs = Math.max(xAbs, Math.abs(skin.positions[i]))
  zMin = Math.min(zMin, skin.positions[i + 2])
  zMax = Math.max(zMax, skin.positions[i + 2])
}
const SCALE = (H - 2 * MARGIN) / (zMax - zMin)
const W = 2 * Math.ceil(xAbs * SCALE + MARGIN)
const HALF_W = W / 2
const RASTER_W = Math.round((RASTER_H * W) / H / 4) * 4

const zToRow = (z: number) => MARGIN + (zMax - z) * SCALE
const rowToZ = (py: number) => zMax - (py + 0.5 - MARGIN) / SCALE
// Signed lateral distance from the midline, positive toward the given side.
const colToLateral = (px: number, view: View, side: Side) => {
  const x = ((px + 0.5 - HALF_W) / SCALE) * (view === 'F' ? 1 : -1)
  return side === 'l' ? x : -x
}
const lateralToCol = (lat: number, view: View, side: Side) => {
  const x = side === 'l' ? lat : -lat
  return HALF_W + x * SCALE * (view === 'F' ? 1 : -1)
}

function project(m: Mesh, view: View): Float32Array {
  const p = new Float32Array(m.positions.length)
  const sx = view === 'F' ? 1 : -1
  for (let i = 0; i < m.positions.length; i += 3) {
    p[i] = HALF_W + sx * m.positions[i] * SCALE
    p[i + 1] = zToRow(m.positions[i + 2])
    p[i + 2] = view === 'F' ? m.positions[i + 1] : -m.positions[i + 1]
  }
  return p
}

// Drops stray triangles on the wrong side of the midline.
function sideFilter(m: Mesh, side: Side) {
  const sign = side === 'l' ? 1 : -1
  return (a: number, b: number, c: number) =>
    ((m.positions[a * 3] + m.positions[b * 3] + m.positions[c * 3]) / 3) * sign > -15
}

function lineZ(line: Line, lat: number) {
  const [[l0, z0], [l1, z1]] = line
  return z0 + ((lat - l0) * (z1 - z0)) / (l1 - l0)
}

function clipTest(clips: Clip[], view: View, side: Side) {
  if (!clips.length) return undefined
  return (px: number, py: number) => {
    const z = rowToZ(py)
    const lat = colToLateral(px, view, side)
    for (const c of clips) {
      if (c.zMin !== undefined && z < c.zMin) return false
      if (c.zMax !== undefined && z > c.zMax) return false
      if (c.above && z < lineZ(c.above, lat)) return false
      if (c.below && z > lineZ(c.below, lat)) return false
    }
    return true
  }
}

type Label = { index: number; id: string; side: Side; group: string | null; untracked: boolean }

function pointInPolygon(x: number, y: number, poly: [number, number][]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function distToPolyline(x: number, y: number, pts: [number, number][]) {
  let best = Infinity
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1]
    const dx = bx - ax, dy = by - ay
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy))
  }
  return best
}

function renderView(view: View) {
  const t = createTarget(W, H)
  const labels: Label[] = []
  const labelOf = new Map<string, number>()

  const drawPart = (file: string, side: Side | null, label: number, clips: Clip[], maxThickness?: number) => {
    const m = mesh(file)
    const p = project(m, view)
    const keepTri = side ? sideFilter(m, side) : undefined
    const test = side ? clipTest(clips, view, side) : undefined
    if (!maxThickness) {
      drawTriangles(t, p, m.indices, { label, keepTri, test })
      return
    }
    const { near, far } = nearFar(W, H, p, m.indices, keepTri)
    for (let i = 0; i < near.length; i++) {
      if (near[i] === Infinity || near[i] >= t.depth[i]) continue
      const px = i % W
      if (test && !test(px, (i - px) / W)) continue
      t.depth[i] = near[i]
      t.label[i] = far[i] - near[i] < maxThickness ? NEUTRAL : label
    }
  }

  for (const r of fmaMap.regions) {
    const visible = r.views.includes(view)
    for (const side of ['r', 'l'] as Side[]) {
      let label = NEUTRAL
      if (visible) {
        label = labels.length + 2
        labels.push({ index: label, id: r.id, side, group: r.group, untracked: r.kind === 'untracked' })
        labelOf.set(`${r.id}:${side}`, label)
      }
      for (const part of r.parts) {
        const clips = visible ? [r.clip?.[view], part.clip?.[view]].filter((c): c is Clip => !!c) : []
        for (const f of part[side].files) drawPart(f, side, label, clips, part.maxThicknessMm)
      }
    }
  }
  for (const f of fmaMap.occluders.files) drawPart(f, null, NEUTRAL, [])

  for (const r of fmaMap.regions) {
    if (!r.views.includes(view)) continue
    for (const part of r.parts) {
      if (!part.overrides) continue
      const beaten = new Set(part.overrides.flatMap((id) => ['l', 'r'].map((s) => labelOf.get(`${id}:${s}`) ?? -1)))
      for (const side of ['r', 'l'] as Side[]) {
        const label = labelOf.get(`${r.id}:${side}`)!
        const clips = [r.clip?.[view], part.clip?.[view]].filter((c): c is Clip => !!c)
        const test = clipTest(clips, view, side)
        for (const f of part[side].files) {
          const m = mesh(f)
          forEachFragment(W, H, project(m, view), m.indices, (i, px, py) => {
            if (beaten.has(t.label[i]) && (!test || test(px, py))) t.label[i] = label
          }, sideFilter(m, side))
        }
      }
    }
  }

  const silT = createTarget(W, H)
  drawTriangles(silT, project(skin, view), skin.indices, { label: 1 })
  const sil = fillHoles(close(silT.label, W, H, 1), W, H)

  return { t, sil, labels, labelOf }
}

// Our own polygons (muscles missing from BodyParts3D, the back-view gracilis): uncovered skin, plus any listed overrides, inside the polygon.
function fillHandRegions(L: Uint8Array, sil: Uint8Array, view: View, labelOf: Map<string, number>) {
  const filled: number[] = []
  for (const [id, hr] of Object.entries(handRegions)) {
    if (hr.view !== view) continue
    for (const side of ['r', 'l'] as Side[]) {
      const label = labelOf.get(`${id}:${side}`)
      if (!label) throw new Error(`hand region ${id} is not a visible region in ${view}`)
      filled.push(label)
      const beaten = new Set([NEUTRAL, ...(hr.override ?? []).map((o) => labelOf.get(`${o}:${side}`) ?? -1)])
      const poly = hr.polygon.map(([lat, z]) => [lateralToCol(lat, view, side), zToRow(z)] as [number, number])
      const gaps = (hr.gaps ?? []).map((g) => ({
        pts: g.line.map(([lat, z]) => [lateralToCol(lat, view, side), zToRow(z)] as [number, number]),
        half: (g.widthMm * SCALE) / 2,
      }))
      const ys = poly.map((q) => q[1]), xs = poly.map((q) => q[0])
      for (let py = Math.max(0, Math.floor(Math.min(...ys))); py <= Math.min(H - 1, Math.ceil(Math.max(...ys))); py++) {
        for (let px = Math.max(0, Math.floor(Math.min(...xs))); px <= Math.min(W - 1, Math.ceil(Math.max(...xs))); px++) {
          const i = py * W + px
          if (!sil[i] || !beaten.has(L[i])) continue
          if (!pointInPolygon(px + 0.5, py + 0.5, poly)) continue
          if (gaps.some((g) => distToPolyline(px + 0.5, py + 0.5, g.pts) < g.half)) continue
          L[i] = label
        }
      }
    }
  }
  return filled
}

function prepare(t: Target, sil: Uint8Array) {
  const L = t.label.slice()
  let bodyArea = 0
  for (let i = 0; i < L.length; i++) {
    if (sil[i]) bodyArea++
    if (!sil[i]) L[i] = NONE
    else if (L[i] === NONE) L[i] = NEUTRAL
  }
  return { L, bodyArea, minPiece: Math.round(bodyArea * MIN_PIECE) }
}

// Morphological open per label, then drop pieces under minPiece. Removed pixels become neutral.
function cleanLabels(L: Uint8Array, indices: number[], minPiece: number) {
  for (const index of indices) {
    const c = crop(maskOf(L, (v) => v === index), W, H, OPEN_RADIUS + 1)
    if (!c) continue
    const opened = open(c.data, c.w, c.h, OPEN_RADIUS)
    const { ids, sizes } = components(opened, c.w, c.h)
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const k = y * c.w + x
        if (c.data[k] && (!opened[k] || sizes[ids[k]] < minPiece)) L[(c.y0 + y) * W + c.x0 + x] = NEUTRAL
      }
    }
  }
}

function maskOf(L: Uint8Array, pred: (l: number) => boolean) {
  const m = new Uint8Array(L.length)
  for (let i = 0; i < L.length; i++) m[i] = pred(L[i]) ? 1 : 0
  return m
}

function traceRegion(m: Uint8Array, sil: Uint8Array, tolerance: number, minRingArea: number, closeRadius = 0): Ring[] {
  const c = crop(m, W, H, closeRadius + 2 + Math.ceil(BLUR * 3))
  if (!c) return []
  const d = dilate(closeRadius ? close(c.data, c.w, c.h, closeRadius) : c.data, c.w, c.h, 1)
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) d[y * c.w + x] &= sil[(c.y0 + y) * W + c.x0 + x]
  return traceMask(d, c.w, c.h, tolerance, minRingArea, BLUR).map((r) => r.map(([x, y]) => [x + c.x0, y + c.y0] as [number, number]))
}

const attrs = (o: Record<string, string | undefined>) =>
  Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${v}"`).join('')

function bake(view: View) {
  const started = Date.now()
  const { t, sil, labels, labelOf } = renderView(view)
  const { L, bodyArea, minPiece } = prepare(t, sil)
  cleanLabels(L, labels.map((l) => l.index), minPiece)
  cleanLabels(L, fillHandRegions(L, sil, view, labelOf), minPiece)
  const name = view === 'F' ? 'front' : 'back'
  const viewBox = `0 0 ${W} ${H}`

  // Full map
  const silRings = traceMask(sil, W, H, TOLERANCE, minPiece, BLUR)
  const regionPaths: string[] = []
  const report: { id: string; side: Side; pixels: number }[] = []
  for (const l of labels) {
    const m = maskOf(L, (v) => v === l.index)
    const pixels = m.reduce((a, b) => a + b, 0)
    report.push({ id: l.id, side: l.side, pixels })
    if (!pixels) continue
    const rings = traceRegion(m, sil, TOLERANCE, minPiece / 4)
    if (!rings.length) continue
    const a = l.untracked
      ? { 'data-untracked': l.id, 'data-side': l.side }
      : { 'data-head': l.id, 'data-group': l.group!, 'data-side': l.side }
    regionPaths.push(`<path${attrs(a)} d="${pathData(rings, 1)}"${rings.length > 1 ? ' fill-rule="evenodd"' : ''}/>`)
  }
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`,
    CREDIT,
    `<g id="silhouette"><path d="${pathData(silRings, 1)}" fill-rule="evenodd"/></g>`,
    `<g id="regions">`,
    ...regionPaths,
    `</g>`,
    `</svg>`,
  ].join('\n')
  fs.writeFileSync(path.join(OUT_DIR, `${name}.svg`), svg + '\n')

  // Mini map: one merged path per group and side
  const groupOrder = taxonomy.groups.map((g) => g.id)
  const groupsInView = groupOrder.filter((g) => labels.some((l) => l.group === g))
  const groupPaths: string[] = []
  for (const g of groupsInView) {
    for (const side of ['r', 'l'] as Side[]) {
      const idx = new Set(labels.filter((l) => l.group === g && l.side === side).map((l) => l.index))
      const rings = traceRegion(maskOf(L, (v) => idx.has(v)), sil, GROUP_TOLERANCE, minPiece / 2, 2)
      if (!rings.length) continue
      groupPaths.push(`<path${attrs({ 'data-group': g, 'data-side': side })} d="${pathData(rings, 0)}"${rings.length > 1 ? ' fill-rule="evenodd"' : ''}/>`)
    }
  }
  const miniSil = traceMask(sil, W, H, GROUP_TOLERANCE, minPiece, BLUR)
  const groupsSvg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`,
    CREDIT,
    `<g id="silhouette"><path d="${pathData(miniSil, 0)}" fill-rule="evenodd"/></g>`,
    `<g id="groups">`,
    ...groupPaths,
    `</g>`,
    `</svg>`,
  ].join('\n')
  fs.writeFileSync(path.join(OUT_DIR, `${name}.groups.svg`), groupsSvg + '\n')

  // Hit-test raster: group index per cell, mode of the covered source pixels
  const groupIndex = new Map(groupsInView.map((g, i) => [g, i + 1]))
  const labelGroup = new Uint8Array(256)
  for (const l of labels) if (l.group && !l.untracked) labelGroup[l.index] = groupIndex.get(l.group)!
  const cells = new Uint8Array(RASTER_W * RASTER_H)
  const counts = new Uint32Array(groupsInView.length + 1)
  for (let cy = 0; cy < RASTER_H; cy++) {
    const y0 = Math.floor((cy * H) / RASTER_H), y1 = Math.floor(((cy + 1) * H) / RASTER_H)
    for (let cx = 0; cx < RASTER_W; cx++) {
      const x0 = Math.floor((cx * W) / RASTER_W), x1 = Math.floor(((cx + 1) * W) / RASTER_W)
      counts.fill(0)
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) counts[labelGroup[L[y * W + x]]]++
      let best = 0
      for (let k = 1; k < counts.length; k++) if (counts[k] > counts[best]) best = k
      cells[cy * RASTER_W + cx] = best
    }
  }
  const bin = encodeIdRaster({ width: RASTER_W, height: RASTER_H, vbWidth: W, vbHeight: H, groups: groupsInView, data: cells })
  fs.writeFileSync(path.join(OUT_DIR, `${name}.ids.bin`), bin)

  if (DEBUG) writeDebugPng(path.join(QA_DIR, `debug-${name}.png`), L, view)
  const missing = report.filter((r) => r.pixels === 0)
  console.log(
    `${name}: ${W}x${H}, body ${bodyArea} px, ${regionPaths.length} region paths, ${groupPaths.length} group paths, ` +
      `raster ${RASTER_W}x${RASTER_H} ${bin.length} B, ${Date.now() - started} ms`,
  )
  if (missing.length) console.log(`  empty: ${missing.map((m) => `${m.id}:${m.side}`).join(', ')}`)
  return report
}

function colorOf(label: number): [number, number, number] {
  if (label === NONE) return [255, 255, 255]
  if (label === NEUTRAL) return [205, 205, 205]
  const h = (label * 137.508) % 360
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (0.55 - 0.4 * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

// Label raster with a 50 mm grid (lateral from midline, z) for authoring hand polygons.
function writeDebugPng(file: string, L: Uint8Array, view: View) {
  const png = new PNG({ width: W, height: H })
  for (let i = 0; i < W * H; i++) {
    const px = i % W, py = (i - px) / W
    let [r, g, b] = colorOf(L[i])
    const lat = Math.abs(colToLateral(px, view, 'l')), z = rowToZ(py)
    const onGrid = Math.abs(lat % 50) < 0.45 / SCALE * 2 || Math.abs(z % 50) < 0.45 / SCALE * 2
    if (onGrid) {
      const strong = Math.abs(lat % 100) < 1 || Math.abs(z % 100) < 1
      const k = strong ? 0.45 : 0.75
      r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k)
    }
    png.data[i * 4] = r
    png.data[i * 4 + 1] = g
    png.data[i * 4 + 2] = b
    png.data[i * 4 + 3] = 255
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, PNG.sync.write(png))
}

fs.mkdirSync(OUT_DIR, { recursive: true })
const reports = { F: bake('F'), B: bake('B') }
if (DEBUG) {
  fs.mkdirSync(QA_DIR, { recursive: true })
  fs.writeFileSync(path.join(QA_DIR, 'regions.json'), JSON.stringify(reports, null, 1))
}

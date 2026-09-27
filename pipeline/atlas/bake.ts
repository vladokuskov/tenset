// Bakes the figure's muscle atlas from register.ts output into the MakeHuman UV layout:
//   public/models/atlas-regions.webp  region index per texel (lossless, sample with nearest / texelFetch)
//   public/models/atlas-relief.webp   8-bit height map (lossy): muscle bellies and grooves
//   public/models/atlas-fibre.webp    8-bit fibre striation (lossy), kept apart for precision
//   public/models/atlas.json          region table (index -> head, group, side) and texture list
// node pipeline/atlas/bake.ts [--debug]
import fs from 'node:fs'
import path from 'node:path'
import { PUBLIC, ROOT } from '../lib/paths.ts'
import { conceptFiles } from './bp3d.ts'
import { loadFigure } from './figure.ts'
import { closeGaps, dropSpecks, fillHoles, fillUnknown, modeFilter, pad, texelArea, UNKNOWN } from './labels.ts'
import { bakeRelief } from './relief.ts'
import { loadTexels } from './texels.ts'
import { encodeWebp, writePng } from './webp.ts'
import type { RegionEntry, Segment } from './anatomy3d.ts'
import { ATLAS_CACHE } from './paths.ts'

const OUT = path.join(PUBLIC, 'models')
const DEBUG_DIR = path.join(ROOT, 'qa/out/s1v2')
const DEBUG = process.argv.includes('--debug')
export const CREDIT = 'BodyParts3D, © The Database Center for Life Science, CC BY 4.0, modified'
const PAD = 12
const MIN_REGION_MM2 = 150
const MIN_SEGMENT_MM2 = 500
/** bare-skin gaps narrower than this between parts of one muscle group are closed (mm) */
const GAP_MM = 7
/** the oblique's slips leave wider gaps over the ribs in BodyParts3D; the living flank is covered */
const GAP_OBLIQUE_MM = 24
const HOLE_MM2 = 1200
const FLANK_HOLE_MM2 = 4000
const BUDGET = 1.2 * 1024 * 1024

type Meta = { res: number; regions: RegionEntry[]; segments: Segment[] }

async function main() {
  const started = Date.now()
  const T = loadTexels(ATLAS_CACHE)
  const meta = JSON.parse(fs.readFileSync(path.join(ATLAS_CACHE, 'register.json'), 'utf8')) as Meta
  const N = T.res
  const fig = await loadFigure('a')
  const area = texelArea(T, fig.rest, fig.uv, fig.indices)
  const inside = (k: number) => T.tri[k] >= 0

  // labels: missed projections and specks are refilled from their neighbours
  const L = new Uint16Array(N * N).fill(UNKNOWN)
  for (let k = 0; k < N * N; k++) if (inside(k) && !Number.isNaN(T.skin[k * 3])) L[k] = T.label[k]
  const missed = fillUnknown(L, inside, N)
  const specks = dropSpecks(L, inside, area, N, (v) => (v === 0 ? 40 : MIN_REGION_MM2))
  fillUnknown(L, inside, N)
  const groupOf = (v: number) => (v ? (meta.regions[v - 1]?.group ?? null) : null)
  // the serratus and oblique slips interdigitate on the flank, so gaps between them close like gaps inside one group
  const gapGroupOf = (v: number) => {
    const g = groupOf(v)
    return g === 'serratus' || g === 'obliques' ? 'flank' : g
  }
  const gaps = closeGaps(L, inside, area, N, (g) => (g === 'flank' ? GAP_OBLIQUE_MM : GAP_MM), gapGroupOf)
  // bare pockets between the serratus and oblique slips read as dents on the flank, so those close up to a larger size
  const holes = fillHoles(L, inside, area, N, HOLE_MM2) + fillHoles(L, inside, area, N, FLANK_HOLE_MM2, (v) => gapGroupOf(v) === 'flank')
  modeFilter(L, inside, N, 3, 3)
  dropSpecks(L, inside, area, N, (v) => (v === 0 ? 60 : MIN_REGION_MM2))
  fillUnknown(L, inside, N)

  // relief segments must agree with the final label; refill the ones that don't from same-label neighbours
  const segLabel = (s: number) => (s === 0 ? 0 : meta.segments[s - 1].label)
  const S = new Uint16Array(N * N).fill(UNKNOWN)
  for (let k = 0; k < N * N; k++) if (inside(k) && segLabel(T.segment[k]) === L[k] && !Number.isNaN(T.skin[k * 3])) S[k] = T.segment[k]
  dropSpecks(S, inside, area, N, () => MIN_SEGMENT_MM2)
  fillSegments(S, L, inside, N, segLabel)
  modeFilter(S, inside, N, 4, 3)
  for (let k = 0; k < N * N; k++) if (inside(k) && segLabel(S[k]) !== L[k]) S[k] = UNKNOWN
  fillSegments(S, L, inside, N, segLabel)

  const regions = new Uint8Array(N * N)
  const filled = new Uint8Array(N * N)
  for (let k = 0; k < N * N; k++) {
    if (!inside(k)) continue
    regions[k] = L[k]
    filled[k] = 1
  }
  pad(regions, 1, filled, N, PAD)

  const bones = new Set([...conceptFiles('bone organ'), ...conceptFiles('cartilage organ')])
  const relief = bakeRelief({ T, area, S, segments: meta.segments, bones, fig, debug: DEBUG ? DEBUG_DIR : null })

  const rgbIds = new Uint8Array(N * N * 4)
  for (let k = 0; k < N * N; k++) {
    rgbIds[k * 4] = regions[k]
    rgbIds[k * 4 + 3] = 255
  }
  fs.mkdirSync(OUT, { recursive: true })
  const files = encodeWebp([
    { out: path.join(OUT, 'atlas-regions.webp'), width: N, height: N, rgba: rgbIds, quality: 100 },
    { out: path.join(OUT, 'atlas-relief.webp'), width: relief.res, height: relief.res, rgba: relief.height, quality: relief.quality },
    { out: path.join(OUT, 'atlas-fibre.webp'), width: relief.res, height: relief.res, rgba: relief.fibre, quality: relief.fibreQuality },
  ])
  const total = files.reduce((a, f) => a + f.bytes, 0)

  const present = new Set(regions)
  const atlas = {
    copyright: CREDIT,
    credit: 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International',
    source: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/ (Release 4.0)',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    comment: 'Region atlas and muscle relief derived from BodyParts3D: superficial muscles registered onto the MakeHuman body, projected along its normals, relabelled to our taxonomy and baked into its UV layout. The latissimus dorsi and rectus abdominis regions and the relief shapes are our own.',
    version: 3,
    uv: 'TEXCOORD_0 of the body mesh, glTF orientation (flipY = false)',
    textures: {
      regions: { file: 'atlas-regions.webp', size: N, encoding: 'R = region index (0 = none), lossless; sample with texelFetch / nearest' },
      relief: { file: 'atlas-relief.webp', size: relief.res, minMm: relief.minMm, maxMm: relief.maxMm, encoding: 'R = height, minMm + R / 255 * (maxMm - minMm) millimetres along the normal; linear, mipmapped' },
      fibre: { file: 'atlas-fibre.webp', size: relief.res, amplitudeMm: relief.fibreMm, encoding: 'R = fibre striation, (R - 128) / 127 * amplitudeMm millimetres along the normal; linear, mipmapped' },
    },
    regions: meta.regions.map((r, i) => ({
      index: i + 1,
      head: r.untracked ? null : r.id,
      untracked: r.untracked ? r.id : undefined,
      group: r.group,
      side: r.side,
      views: r.views.join(''),
      present: present.has(i + 1),
    })),
  }
  fs.writeFileSync(path.join(OUT, 'atlas.json'), JSON.stringify(atlas, null, 1) + '\n')

  if (DEBUG) {
    const png = new Uint8Array(N * N * 4)
    for (let k = 0; k < N * N; k++) {
      const c = inside(k) ? colorOf(L[k]) : [255, 255, 255]
      png.set([...c, 255], k * 4)
    }
    writePng(path.join(DEBUG_DIR, 'atlas-uv-regions.png'), N, N, png)
  }
  const summary = {
    res: N,
    missedFilled: missed,
    specksDropped: specks,
    gapTexelsClosed: gaps,
    holesFilled: holes,
    files: files.map((f) => ({ file: path.relative(ROOT, f.out), bytes: f.bytes })),
    totalBytes: total,
    absent: atlas.regions.filter((r) => !r.present).map((r) => `${r.head ?? r.untracked}:${r.side}`),
    seconds: (Date.now() - started) / 1000,
  }
  console.log(JSON.stringify(summary, null, 1))
  if (total > BUDGET) throw new Error(`atlas textures are ${total} bytes, over the ${BUDGET} budget`)
}

function fillSegments(S: Uint16Array, L: Uint16Array, inside: (k: number) => boolean, N: number, segLabel: (s: number) => number) {
  let todo: number[] = []
  for (let k = 0; k < N * N; k++) if (inside(k) && S[k] === UNKNOWN) todo.push(k)
  const counts = new Map<number, number>()
  for (let iter = 0; iter < 400 && todo.length; iter++) {
    const next: number[] = []
    const set: [number, number][] = []
    for (const k of todo) {
      const x = k % N, y = (k - x) / N
      counts.clear()
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= N || yy >= N) continue
        const v = S[yy * N + xx]
        if (v !== UNKNOWN && inside(yy * N + xx) && segLabel(v) === L[k]) counts.set(v, (counts.get(v) ?? 0) + 1)
      }
      let best = -1, bc = 0
      for (const [v, c] of counts) if (c > bc) { best = v; bc = c }
      if (best >= 0) set.push([k, best])
      else next.push(k)
    }
    for (const [k, v] of set) S[k] = v
    todo = next
  }
  for (const k of todo) S[k] = 0
}

export function colorOf(label: number): [number, number, number] {
  if (label === 0) return [205, 205, 205]
  const h = (label * 137.508) % 360
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (0.55 - 0.4 * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

await main()

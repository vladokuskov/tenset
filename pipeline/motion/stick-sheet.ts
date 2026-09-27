// Orthographic stick-figure contact sheet (side / front / top x 8 phases + onion overlay) rendered in Node with pngjs.
// node pipeline/motion/stick-sheet.ts --template squat [--params '{"hold":"back_low"}'] [--out qa/out/motion/x.sheet.png]
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { bake, frameImplements, frameQ, type Baked } from '../../src/motion/bake.ts'
import { fk, segPos, sitePos, sticks, type FK } from '../../src/motion/fk.ts'
import { cableForce, siteWorld, type ImplementSpec, type Part } from '../../src/motion/implements.ts'
import { add, qrot, type V3 } from '../../src/motion/math.ts'
import type { ImplementPose, Skeleton } from '../../src/motion/skeleton.ts'
import { getTemplate, parseParams } from '../../src/motion/templates/index.ts'
import { phaseAt } from '../../src/motion/timing.ts'
import { ROOT } from '../lib/paths.ts'
import { createCanvas, disc, fillRect, line, ring, savePng, text, type Canvas, type RGB } from './canvas.ts'
import { loadSkeleton } from './load.ts'

type View = { name: string; proj: (v: V3) => [number, number] }
const VIEWS: View[] = [
  { name: 'side', proj: (v) => [v[2], v[1]] },
  { name: 'front', proj: (v) => [v[0], v[1]] },
  { name: 'top', proj: (v) => [-v[0], v[2]] },
]

const LEFT: RGB = [0, 114, 178]
const RIGHT: RGB = [213, 94, 0]
const MID: RGB = [55, 55, 55]
const IMPL: RGB = [125, 125, 125]
const CONTACT: RGB = [0, 150, 90]
const INK: RGB = [40, 40, 40]
const CABLE: RGB = [150, 60, 150]

const colorOf = (segment: string): RGB => (segment.endsWith('_l') ? LEFT : segment.endsWith('_r') ? RIGHT : MID)

type Frame = { f: FK; impl: ImplementPose[] }

function implementSegments(spec: ImplementSpec, pose: ImplementPose): { a: V3; b: V3; r: number; box?: V3[] }[] {
  const w = (p: V3) => add(pose.pos, qrot(pose.rot, p))
  return spec.parts.map((part: Part) => {
    if (part.shape === 'cylinder') return { a: w(part.a), b: w(part.b), r: part.r }
    const [sx, sy, sz] = part.size.map((s) => s / 2)
    const corners: V3[] = []
    for (const x of [-sx, sx]) for (const y of [-sy, sy]) for (const z of [-sz, sz]) {
      const local = part.rot ? qrot(part.rot, [x, y, z]) : ([x, y, z] as V3)
      corners.push(w(add(part.center, local)))
    }
    return { a: corners[0], b: corners[7], r: 0, box: corners }
  })
}

const BOX_EDGES: [number, number][] = [[0, 1], [0, 2], [0, 4], [3, 1], [3, 2], [3, 7], [5, 1], [5, 4], [5, 7], [6, 2], [6, 4], [6, 7]]

function drawFrame(c: Canvas, skel: Skeleton, b: Baked, fr: Frame, view: View, map: (p: [number, number]) => [number, number], scale: number, alpha: number, tint?: RGB) {
  const P = (v: V3) => map(view.proj(v))
  b.implements.forEach((spec, k) => {
    for (const s of implementSegments(spec, fr.impl[k])) {
      if (s.box) {
        for (const [i, j] of BOX_EDGES) {
          const [x0, y0] = P(s.box[i]), [x1, y1] = P(s.box[j])
          line(c, x0, y0, x1, y1, tint ?? IMPL, 1, alpha * 0.8)
        }
        continue
      }
      const [x0, y0] = P(s.a), [x1, y1] = P(s.b)
      const lenPx = Math.hypot(x1 - x0, y1 - y0)
      const len3 = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2])
      const rPx = Math.max(0.6, s.r * scale)
      const col = tint ?? IMPL
      if (lenPx < 0.2 * len3 * scale) ring(c, (x0 + x1) / 2, (y0 + y1) / 2, rPx, col, 1.2, alpha)
      else if (len3 < s.r) {
        // short fat cylinder (plate) seen from the side: a bar across the axis
        const ux = -(y1 - y0) / lenPx, uy = (x1 - x0) / lenPx
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
        line(c, cx - ux * rPx, cy - uy * rPx, cx + ux * rPx, cy + uy * rPx, col, Math.max(1.5, lenPx), alpha * 0.55)
      } else line(c, x0, y0, x1, y1, col, Math.max(1, 2 * rPx), alpha * 0.55)
    }
  })
  for (const cable of b.cables ?? []) {
    const k = b.implements.findIndex((x) => x.id === cable.implement)
    const [x0, y0] = P(cable.pulley), [x1, y1] = P(cableForce(cable, fr.impl[k]).at)
    line(c, x0, y0, x1, y1, tint ?? CABLE, 1, alpha * 0.8)
  }
  for (const s of sticks(skel, fr.f)) {
    const [x0, y0] = P(s.a), [x1, y1] = P(s.b)
    line(c, x0, y0, x1, y1, tint ?? colorOf(s.segment), 2.2, alpha)
  }
  for (const s of skel.segments) {
    const [x, y] = P(fr.f.pos[s.index])
    disc(c, x, y, 2, tint ?? colorOf(s.name), alpha)
  }
  const head = segPos(skel, fr.f, 'head')
  const top = sitePos(skel, fr.f, 'head_top')
  const [hx, hy] = P([(head[0] + top[0]) / 2, (head[1] + top[1]) / 2, (head[2] + top[2]) / 2])
  ring(c, hx, hy, 0.095 * scale, tint ?? MID, 2, alpha)
}

export function stickSheet(b: Baked, skel: Skeleton, title: string, file: string, phases = 8) {
  const CW = 250, CH = 330, TOP = 44, LEFTM = 60
  const cols = phases + 1
  const c = createCanvas(LEFTM + cols * CW + 10, TOP + VIEWS.length * CH + 10)
  const frameAt = (u: number): Frame => {
    const i = Math.round(u * b.frames) % b.frames
    return { f: fk(skel, frameQ(b, i)), impl: frameImplements(b, i) }
  }
  const all = Array.from({ length: b.frames }, (_, i) => frameAt(i / b.frames))
  text(c, 10, 10, title, INK, 2)
  VIEWS.forEach((view, row) => {
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity]
    const grow = (v: V3) => {
      const p = view.proj(v)
      lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])]
      hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])]
    }
    for (const fr of all) {
      for (const s of sticks(skel, fr.f)) [s.a, s.b].forEach(grow)
      b.implements.forEach((spec, k) => {
        for (const site of Object.keys(spec.sites)) grow(siteWorld(spec, fr.impl[k], site).pos)
      })
    }
    if (view.name !== 'top') grow([0, 0, 0])
    const scale = Math.min((CW - 30) / (hi[0] - lo[0] + 0.3), (CH - 40) / (hi[1] - lo[1] + 0.3))
    const center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]
    const y0 = TOP + row * CH
    text(c, 8, y0 + CH / 2, view.name, INK)
    for (let k = 0; k < cols; k++) {
      const x0 = LEFTM + k * CW
      fillRect(c, x0 + 2, y0 + 2, CW - 4, CH - 4, [248, 248, 246])
      const map = (p: [number, number]): [number, number] => [x0 + CW / 2 + (p[0] - center[0]) * scale, y0 + CH / 2 + 8 - (p[1] - center[1]) * scale]
      if (view.name !== 'top') {
        const [, fy] = map([0, 0])
        line(c, x0 + 6, fy, x0 + CW - 6, fy, [190, 190, 190], 1)
      }
      if (k < phases) {
        const u = k / phases
        for (let g = 3; g >= 1; g--) drawFrame(c, skel, b, frameAt((u - g * 0.025 + 1) % 1), view, map, scale, 0.13)
        const fr = frameAt(u)
        drawFrame(c, skel, b, fr, view, map, scale, 1)
        for (const ct of b.contacts) {
          const p = sitePos(skel, fr.f, ct.site)
          const [x, y] = map(view.proj(p))
          line(c, x - 3, y - 3, x + 3, y + 3, CONTACT, 1.2)
          line(c, x - 3, y + 3, x + 3, y - 3, CONTACT, 1.2)
        }
        if (row === 0) {
          const ph = phaseAt(u, b.tempo)
          text(c, x0 + 6, y0 + 6, `U ${u.toFixed(3)} C ${ph.c.toFixed(2)} ${ph.name}`, INK)
        }
      } else {
        for (let p = 0; p < phases; p++) {
          const t = p / phases
          const tint: RGB = [Math.round(40 + 180 * t), Math.round(90 + 60 * (1 - t)), Math.round(200 - 150 * t)]
          drawFrame(c, skel, b, frameAt(t), view, map, scale, 0.45, tint)
        }
        if (row === 0) text(c, x0 + 6, y0 + 6, 'ONION: ALL PHASES', INK)
      }
    }
  })
  savePng(c, file)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      template: { type: 'string' },
      params: { type: 'string', default: '{}' },
      laterality: { type: 'string' },
      out: { type: 'string' },
      fps: { type: 'string', default: '30' },
    },
  })
  if (!values.template) throw new Error('--template is required')
  const skel = loadSkeleton()
  const params = parseParams(values.template, JSON.parse(values.params!), values.laterality)
  const b = bake(getTemplate(values.template), params, skel, Number(values.fps))
  const out = path.resolve(ROOT, values.out ?? `qa/out/motion/${values.template}.sheet.png`)
  mkdirSync(path.dirname(out), { recursive: true })
  stickSheet(b, skel, `${values.template} ${JSON.stringify(values.params)}`, out)
  console.log(`wrote ${path.relative(ROOT, out)}`)
}

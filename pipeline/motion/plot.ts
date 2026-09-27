// Joint angles over one loop as a PNG line chart (varying DOFs only), plus root height/forward travel.
import type { Baked } from '../../src/motion/bake.ts'
import type { Skeleton } from '../../src/motion/skeleton.ts'
import { createCanvas, fillRect, line, PALETTE, polyline, savePng, text, textWidth, type Canvas, type RGB } from './canvas.ts'

const INK: RGB = [40, 40, 40]
const GRID: RGB = [225, 225, 225]

function panel(c: Canvas, x: number, y: number, w: number, h: number, series: { name: string; values: number[]; color: RGB }[], unit: string, frames: number) {
  let lo = Infinity, hi = -Infinity
  for (const s of series) for (const v of s.values) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)]
  if (!Number.isFinite(lo)) return
  if (hi - lo < 1e-6) [lo, hi] = [lo - 1, hi + 1]
  const pad = (hi - lo) * 0.06
  lo -= pad
  hi += pad
  const sx = (i: number) => x + (i / (frames - 1)) * w
  const sy = (v: number) => y + h - ((v - lo) / (hi - lo)) * h
  const step = niceStep((hi - lo) / 6)
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    line(c, x, sy(v), x + w, sy(v), GRID, 1)
    const label = `${Math.round(v * 100) / 100}`
    text(c, x - textWidth(label) - 4, sy(v) - 3, label, INK)
  }
  for (let k = 0; k <= 8; k++) {
    const gx = x + (k / 8) * w
    line(c, gx, y, gx, y + h, GRID, 1)
    text(c, gx - 9, y + h + 6, (k / 8).toFixed(2).slice(1), INK)
  }
  line(c, x, y, x, y + h, INK, 1)
  line(c, x, y + h, x + w, y + h, INK, 1)
  text(c, x, y - 12, unit, INK)
  for (const s of series) polyline(c, s.values.map((v, i) => [sx(i), sy(v)] as [number, number]), s.color, 2)
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

export function plotAngles(b: Baked, skel: Skeleton, title: string, file: string) {
  const W = 1300, H = 820
  const c = createCanvas(W, H)
  text(c, 20, 14, title, INK, 2)
  const angle: { name: string; values: number[]; color: RGB }[] = []
  const root: { name: string; values: number[]; color: RGB }[] = []
  for (const d of skel.dofs) {
    const values = Array.from({ length: b.frames }, (_, i) => b.q[i * b.nDof + d.index])
    const range = Math.max(...values) - Math.min(...values)
    if (d.unit === 'deg' && range > 1 && (!b.symmetric || !/_r\./.test(d.name))) angle.push({ name: d.name, values, color: PALETTE[angle.length % PALETTE.length] })
    if (d.unit === 'm' && range > 0.002) root.push({ name: d.name, values: values.map((v) => v * 100), color: PALETTE[(root.length + 3) % PALETTE.length] })
  }
  panel(c, 80, 60, 900, 480, angle, b.symmetric ? 'deg (symmetric: right side omitted)' : 'deg', b.frames)
  panel(c, 80, 620, 900, 150, root, 'cm', b.frames)
  const all = [...angle, ...root]
  all.forEach((s, i) => {
    const ly = 60 + i * 16
    fillRect(c, 1010, ly, 18, 8, s.color)
    text(c, 1034, ly, s.name, INK)
  })
  text(c, 80, H - 18, 'loop fraction (0 = mid top pause)', INK)
  savePng(c, file)
}

// Minimal RGBA raster for QA images: antialiased thick lines, discs, rectangles and a 5x7 bitmap font. PNG via pngjs.
import { writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

export type RGB = [number, number, number]
export type Canvas = { w: number; h: number; data: Uint8Array }

export function createCanvas(w: number, h: number, bg: RGB = [255, 255, 255]): Canvas {
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4)
  return { w, h, data }
}

export function blend(c: Canvas, x: number, y: number, rgb: RGB, a: number) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h || a <= 0) return
  const i = (y * c.w + x) * 4
  const k = Math.min(1, a)
  for (let j = 0; j < 3; j++) c.data[i + j] = Math.round(c.data[i + j] * (1 - k) + rgb[j] * k)
}

export function line(c: Canvas, x0: number, y0: number, x1: number, y1: number, rgb: RGB, width = 1, alpha = 1) {
  const r = Math.max(0.5, width / 2)
  const minX = Math.floor(Math.min(x0, x1) - r - 1), maxX = Math.ceil(Math.max(x0, x1) + r + 1)
  const minY = Math.floor(Math.min(y0, y1) - r - 1), maxY = Math.ceil(Math.max(y0, y1) + r + 1)
  const dx = x1 - x0, dy = y1 - y0
  const l2 = dx * dx + dy * dy
  for (let y = Math.max(0, minY); y <= Math.min(c.h - 1, maxY); y++) {
    for (let x = Math.max(0, minX); x <= Math.min(c.w - 1, maxX); x++) {
      const px = x + 0.5 - x0, py = y + 0.5 - y0
      const t = l2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0
      const d = Math.hypot(px - t * dx, py - t * dy)
      const cov = Math.max(0, Math.min(1, r + 0.5 - d))
      if (cov > 0) blend(c, x, y, rgb, cov * alpha)
    }
  }
}

export function polyline(c: Canvas, pts: [number, number][], rgb: RGB, width = 1, alpha = 1) {
  for (let i = 0; i + 1 < pts.length; i++) line(c, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], rgb, width, alpha)
}

export function disc(c: Canvas, cx: number, cy: number, r: number, rgb: RGB, alpha = 1) {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      blend(c, x, y, rgb, Math.max(0, Math.min(1, r + 0.5 - d)) * alpha)
    }
  }
}

export function ring(c: Canvas, cx: number, cy: number, r: number, rgb: RGB, width = 1, alpha = 1) {
  for (let y = Math.floor(cy - r - width); y <= Math.ceil(cy + r + width); y++) {
    for (let x = Math.floor(cx - r - width); x <= Math.ceil(cx + r + width); x++) {
      const d = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r)
      blend(c, x, y, rgb, Math.max(0, Math.min(1, width / 2 + 0.5 - d)) * alpha)
    }
  }
}

export function fillRect(c: Canvas, x: number, y: number, w: number, h: number, rgb: RGB, alpha = 1) {
  for (let j = Math.max(0, Math.floor(y)); j < Math.min(c.h, Math.ceil(y + h)); j++)
    for (let i = Math.max(0, Math.floor(x)); i < Math.min(c.w, Math.ceil(x + w)); i++) blend(c, i, j, rgb, alpha)
}

const GLYPHS: Record<string, string> = {
  A: '.###.#...##...#######...##...##...#', B: '####.#...##...#####.#...##...#####.', C: '.###.#...##....#....#....#...#.###.',
  D: '####.#...##...##...##...##...#####.', E: '######....#....####.#....#....#####', F: '######....#....####.#....#....#....',
  G: '.###.#...##....#.####...##...#.####', H: '#...##...##...#######...##...##...#', I: '.###...#....#....#....#....#...###.',
  J: '..###...#....#....#....#.#..#..##..', K: '#...##..#.#.#..##...#.#..#..#.#...#', L: '#....#....#....#....#....#....#####',
  M: '#...###.###.#.##.#.##...##...##...#', N: '#...##...###..##.#.##..###...##...#', O: '.###.#...##...##...##...##...#.###.',
  P: '####.#...##...#####.#....#....#....', Q: '.###.#...##...##...##.#.##..#..##.#', R: '####.#...##...#####.#.#..#..#.#...#',
  S: '.#####....#.....###.....#....#####.', T: '#####..#....#....#....#....#....#..', U: '#...##...##...##...##...##...#.###.',
  V: '#...##...##...##...##...#.#.#...#..', W: '#...##...##...##.#.##.#.##.#.#.#.#.', X: '#...##...#.#.#...#...#.#.#...##...#',
  Y: '#...##...#.#.#...#....#....#....#..', Z: '#####....#...#...#...#...#....#####',
  '0': '.###.#...##..###.#.###..##...#.###.', '1': '..#...##....#....#....#....#...###.', '2': '.###.#...#....#...#...#...#...#####',
  '3': '#####...#...#.....#.....##...#.###.', '4': '...#...##..#.#.#..#.#####...#....#.', '5': '######....####.....#....##...#.###.',
  '6': '..##..#...#....####.#...##...#.###.', '7': '#####....#...#...#...#....#....#...', '8': '.###.#...##...#.###.#...##...#.###.',
  '9': '.###.#...##...#.####....#...#..##..', ' ': '...................................', '.': '..........................##...##..',
  ',': '....................##....#...#....', '-': '...............#####...............', '_': '..............................#####',
  ':': '......##...##.........##...##......', '%': '##...##..#...#...#...#...#..##...##', '/': '.........#...#...#...#...#.........',
  '(': '...#...#...#....#....#.....#.....#.', ')': '.#.....#.....#....#....#...#...#...', '+': '.......#....#..#####..#....#.......',
  '=': '..........#####.....#####..........', '<': '...#...#...#...#.....#.....#.....#.', '>': '.#.....#.....#.....#...#...#...#...',
}

export function text(c: Canvas, x: number, y: number, s: string, rgb: RGB = [30, 30, 30], scale = 1) {
  let cx = Math.round(x)
  for (const ch of s.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS[' ']
    for (let r = 0; r < 7; r++)
      for (let k = 0; k < 5; k++) if (g[r * 5 + k] === '#') fillRect(c, cx + k * scale, Math.round(y) + r * scale, scale, scale, rgb)
    cx += 6 * scale
  }
}

export const textWidth = (s: string, scale = 1) => s.length * 6 * scale

export function savePng(c: Canvas, file: string) {
  const png = new PNG({ width: c.w, height: c.h })
  png.data = Buffer.from(c.data)
  writeFileSync(file, PNG.sync.write(png))
}

/** distinct line colours (colour-blind friendly-ish, cycled) */
export const PALETTE: RGB[] = [
  [0, 114, 178], [230, 159, 0], [0, 158, 115], [204, 121, 167], [86, 180, 233], [213, 94, 0], [120, 120, 120], [240, 200, 20],
  [60, 60, 160], [160, 60, 60], [40, 130, 60], [140, 90, 30],
]

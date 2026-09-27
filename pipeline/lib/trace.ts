import { contours } from 'd3-contour'
import simplify from 'simplify-js'
import { crop } from './mask.ts'

export type Ring = [number, number][]

function ringArea(r: Ring) {
  let a = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1])
  return Math.abs(a / 2)
}

function gaussianBlur(src: Uint8Array, w: number, h: number, sigma: number): Float64Array {
  const r = Math.ceil(sigma * 3)
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)))
  const sum = k.reduce((a, b) => a + b, 0)
  for (let i = 0; i < k.length; i++) k[i] /= sum
  const tmp = new Float64Array(w * h)
  const out = new Float64Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let j = -r; j <= r; j++) {
        const xx = x + j
        if (xx >= 0 && xx < w) v += src[y * w + xx] * k[j + r]
      }
      tmp[y * w + x] = v
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let j = -r; j <= r; j++) {
        const yy = y + j
        if (yy >= 0 && yy < h) v += tmp[yy * w + x] * k[j + r]
      }
      out[y * w + x] = v
    }
  }
  return out
}

// Marching squares (d3-contour) + Douglas-Peucker (simplify-js). Coordinates are pixel-edge space.
// blur > 0 traces the 0.5 level of a Gaussian-blurred mask, which rounds off raster and mesh jaggies.
export function traceMask(m: Uint8Array, w: number, h: number, tolerance: number, minRingArea: number, blur = 0): Ring[] {
  const c = crop(m, w, h, 1 + Math.ceil(blur * 3))
  if (!c) return []
  const values = blur ? Array.from(gaussianBlur(c.data, c.w, c.h, blur)) : Array.from(c.data)
  const [geo] = contours().size([c.w, c.h]).smooth(blur > 0).thresholds([0.5])(values)
  const rings: Ring[] = []
  for (const polygon of geo.coordinates) {
    for (const ring of polygon) {
      const pts = simplify(ring.map(([x, y]) => ({ x: x + c.x0, y: y + c.y0 })), tolerance, true)
      const r: Ring = pts.map((p) => [p.x, p.y])
      if (r.length >= 4 && ringArea(r) >= minRingArea) rings.push(r)
    }
  }
  return rings
}

function num(v: number, decimals: number) {
  const s = decimals ? (Math.round(v * 10 ** decimals) / 10 ** decimals).toString() : Math.round(v).toString()
  return s.replace(/^(-?)0\./, '$1.')
}

// Compact path data: absolute move, relative line segments, deltas taken from rounded points.
export function pathData(rings: Ring[], decimals: number): string {
  const q = 10 ** decimals
  let out = ''
  for (const ring of rings) {
    const pts = ring.slice(0, -1).map(([x, y]) => [Math.round(x * q), Math.round(y * q)])
    let [px, py] = pts[0]
    out += `M${num(px / q, decimals)} ${num(py / q, decimals)}l`
    let body = ''
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = pts[i]
      for (const d of [(x - px) / q, (y - py) / q]) {
        const s = num(d, decimals)
        body += body && !s.startsWith('-') && !body.endsWith('l') ? ` ${s}` : s
      }
      px = x
      py = y
    }
    out += body + 'z'
  }
  return out
}

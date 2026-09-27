// The 2D body map (public/anatomy/{front,back}.svg) rasterized in its own orthographic frame, BodyParts3D millimetres
// (x left, z up) -> pixels: px = W / 2 + sx * x * scale, py = MARGIN + (zMax - z) * scale, sx = 1 front, -1 back.
import fs from 'node:fs'
import path from 'node:path'
import { PUBLIC } from '../lib/paths.ts'
import { bpMesh, conceptFiles } from './bp3d.ts'

export const H = 2048, MARGIN = 16
export type View = 'F' | 'B'
export type MapRegion = { index: number; head: string | null; untracked?: string; side: 'l' | 'r' }

export function frame() {
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

export function parsePath(d: string): [number, number][][] {
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
export function fillRings(rings: [number, number][][], W: number, out: Uint8Array, value: number) {
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

export function svgLabels(view: View, W: number, regions: MapRegion[]) {
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

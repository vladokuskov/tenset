// Deterministic software z-buffer rasterizer. Samples pixel centers, no antialiasing.
// Smaller depth wins.

export type Target = { w: number; h: number; depth: Float32Array; label: Uint8Array }

export function createTarget(w: number, h: number): Target {
  return { w, h, depth: new Float32Array(w * h).fill(Infinity), label: new Uint8Array(w * h) }
}

export type Projected = Float32Array // sx, sy, depth per vertex
export type KeepTri = (a: number, b: number, c: number) => boolean
type Visit = (i: number, px: number, py: number, d: number) => void

export function forEachFragment(w: number, h: number, p: Projected, indices: Uint32Array, visit: Visit, keepTri?: KeepTri) {
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2]
    if (keepTri && !keepTri(a, b, c)) continue
    rasterTri(w, h, p, a, b, c, visit)
  }
}

export type DrawOptions = {
  label: number
  keepTri?: KeepTri
  test?: (px: number, py: number) => boolean // false skips the fragment entirely
}

export function drawTriangles(t: Target, p: Projected, indices: Uint32Array, o: DrawOptions) {
  const { depth, label } = t
  const test = o.test
  forEachFragment(t.w, t.h, p, indices, (i, px, py, d) => {
    if (d < depth[i] && (!test || test(px, py))) {
      depth[i] = d
      label[i] = o.label
    }
  }, o.keepTri)
}

// Nearest and farthest surface per pixel for one mesh (used to measure sheet thickness).
export function nearFar(w: number, h: number, p: Projected, indices: Uint32Array, keepTri?: KeepTri) {
  const near = new Float32Array(w * h).fill(Infinity)
  const far = new Float32Array(w * h).fill(-Infinity)
  forEachFragment(w, h, p, indices, (i, _px, _py, d) => {
    if (d < near[i]) near[i] = d
    if (d > far[i]) far[i] = d
  }, keepTri)
  return { near, far }
}

function rasterTri(w: number, h: number, p: Projected, ia: number, ib: number, ic: number, visit: Visit) {
  const x0 = p[ia * 3], y0 = p[ia * 3 + 1], d0 = p[ia * 3 + 2]
  let x1 = p[ib * 3], y1 = p[ib * 3 + 1], d1 = p[ib * 3 + 2]
  let x2 = p[ic * 3], y2 = p[ic * 3 + 1], d2 = p[ic * 3 + 2]
  let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
  if (area === 0 || !Number.isFinite(area)) return
  if (area < 0) {
    ;[x1, x2] = [x2, x1]
    ;[y1, y2] = [y2, y1]
    ;[d1, d2] = [d2, d1]
    area = -area
  }
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
  const maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)))
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
  const maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)))
  if (minX > maxX || minY > maxY) return
  const inv = 1 / area
  for (let py = minY; py <= maxY; py++) {
    const cy = py + 0.5
    for (let px = minX; px <= maxX; px++) {
      const cx = px + 0.5
      const w0 = (x2 - x1) * (cy - y1) - (y2 - y1) * (cx - x1)
      if (w0 < 0) continue
      const w1 = (x0 - x2) * (cy - y2) - (y0 - y2) * (cx - x2)
      if (w1 < 0) continue
      const w2 = (x1 - x0) * (cy - y0) - (y1 - y0) * (cx - x0)
      if (w2 < 0) continue
      visit(py * w + px, px, py, (w0 * d0 + w1 * d1 + w2 * d2) * inv)
    }
  }
}

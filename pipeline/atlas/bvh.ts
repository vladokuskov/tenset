// Triangle BVH (binned SAH) with closest-hit ray queries. Build-time only.

export type Hit = { t: number; tri: number; u: number; v: number }

const BINS = 16
const LEAF = 4

export class Bvh {
  readonly positions: Float32Array
  readonly indices: Uint32Array
  /** triangle order after the build; leaves reference ranges of it */
  readonly order: Uint32Array
  private box: Float32Array // 6 per node
  private node: Uint32Array // 2 per node: leaf ? [offset, count | 0x80000000] : [right child, axis]
  private count = 0

  constructor(positions: Float32Array, indices: Uint32Array) {
    this.positions = positions
    this.indices = indices
    const n = indices.length / 3
    this.order = new Uint32Array(n)
    const cen = new Float32Array(n * 3)
    const bmin = new Float32Array(n * 3)
    const bmax = new Float32Array(n * 3)
    for (let t = 0; t < n; t++) {
      this.order[t] = t
      for (let k = 0; k < 3; k++) {
        const a = positions[indices[t * 3] * 3 + k], b = positions[indices[t * 3 + 1] * 3 + k], c = positions[indices[t * 3 + 2] * 3 + k]
        bmin[t * 3 + k] = Math.min(a, b, c)
        bmax[t * 3 + k] = Math.max(a, b, c)
        cen[t * 3 + k] = (a + b + c) / 3
      }
    }
    const cap = Math.max(1, 2 * Math.ceil(n / 2))
    this.box = new Float32Array(cap * 6)
    this.node = new Uint32Array(cap * 2)
    this.build(0, n, cen, bmin, bmax)
    this.box = this.box.slice(0, this.count * 6)
    this.node = this.node.slice(0, this.count * 2)
  }

  private build(start: number, end: number, cen: Float32Array, bmin: Float32Array, bmax: Float32Array): number {
    const id = this.count++
    const o = this.order
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity
    for (let i = start; i < end; i++) {
      const t = o[i] * 3
      if (bmin[t] < x0) x0 = bmin[t]
      if (bmin[t + 1] < y0) y0 = bmin[t + 1]
      if (bmin[t + 2] < z0) z0 = bmin[t + 2]
      if (bmax[t] > x1) x1 = bmax[t]
      if (bmax[t + 1] > y1) y1 = bmax[t + 1]
      if (bmax[t + 2] > z1) z1 = bmax[t + 2]
      if (cen[t] < cx0) cx0 = cen[t]
      if (cen[t + 1] < cy0) cy0 = cen[t + 1]
      if (cen[t + 2] < cz0) cz0 = cen[t + 2]
      if (cen[t] > cx1) cx1 = cen[t]
      if (cen[t + 1] > cy1) cy1 = cen[t + 1]
      if (cen[t + 2] > cz1) cz1 = cen[t + 2]
    }
    this.box.set([x0, y0, z0, x1, y1, z1], id * 6)
    const n = end - start
    const ext = [cx1 - cx0, cy1 - cy0, cz1 - cz0]
    const axis = ext[0] > ext[1] ? (ext[0] > ext[2] ? 0 : 2) : ext[1] > ext[2] ? 1 : 2
    if (n <= LEAF || ext[axis] <= 1e-9) {
      this.node[id * 2] = start
      this.node[id * 2 + 1] = n | 0x80000000
      return id
    }
    const lo = [cx0, cy0, cz0][axis]
    const scale = BINS / ext[axis]
    const cnt = new Uint32Array(BINS)
    const bb = new Float32Array(BINS * 6).fill(Infinity)
    for (let b = 0; b < BINS; b++) for (let k = 3; k < 6; k++) bb[b * 6 + k] = -Infinity
    for (let i = start; i < end; i++) {
      const t = o[i] * 3
      const b = Math.min(BINS - 1, Math.floor((cen[t + axis] - lo) * scale))
      cnt[b]++
      for (let k = 0; k < 3; k++) {
        if (bmin[t + k] < bb[b * 6 + k]) bb[b * 6 + k] = bmin[t + k]
        if (bmax[t + k] > bb[b * 6 + 3 + k]) bb[b * 6 + 3 + k] = bmax[t + k]
      }
    }
    const area = (m: number[]) => {
      const dx = m[3] - m[0], dy = m[4] - m[1], dz = m[5] - m[2]
      return dx < 0 ? 0 : dx * dy + dy * dz + dz * dx
    }
    const leftA = new Float64Array(BINS), leftN = new Uint32Array(BINS)
    let acc = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], an = 0
    for (let b = 0; b < BINS - 1; b++) {
      for (let k = 0; k < 3; k++) {
        acc[k] = Math.min(acc[k], bb[b * 6 + k])
        acc[3 + k] = Math.max(acc[3 + k], bb[b * 6 + 3 + k])
      }
      an += cnt[b]
      leftA[b] = area(acc)
      leftN[b] = an
    }
    acc = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
    an = 0
    let best = -1, bestCost = Infinity
    for (let b = BINS - 1; b > 0; b--) {
      for (let k = 0; k < 3; k++) {
        acc[k] = Math.min(acc[k], bb[b * 6 + k])
        acc[3 + k] = Math.max(acc[3 + k], bb[b * 6 + 3 + k])
      }
      an += cnt[b]
      const cost = leftA[b - 1] * leftN[b - 1] + area(acc) * an
      if (leftN[b - 1] > 0 && an > 0 && cost < bestCost) {
        bestCost = cost
        best = b
      }
    }
    let mid: number
    if (best < 0) {
      mid = (start + end) >> 1
      const sorted = Array.from(o.subarray(start, end)).sort((a, b) => cen[a * 3 + axis] - cen[b * 3 + axis])
      o.set(sorted, start)
    } else {
      let i = start, j = end - 1
      while (i <= j) {
        const b = Math.min(BINS - 1, Math.floor((cen[o[i] * 3 + axis] - lo) * scale))
        if (b < best) i++
        else {
          const tmp = o[i]
          o[i] = o[j]
          o[j] = tmp
          j--
        }
      }
      mid = i
      if (mid === start || mid === end) mid = (start + end) >> 1
    }
    this.build(start, mid, cen, bmin, bmax)
    const right = this.build(mid, end, cen, bmin, bmax)
    this.node[id * 2] = right
    this.node[id * 2 + 1] = axis
    return id
  }

  /** Closest hit with t in (tMin, tMax); `accept` may reject candidate hits (by tag, clip). Both faces count. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMin: number, tMax: number, accept?: (tri: number, t: number) => boolean): Hit | null {
    const P = this.positions, I = this.indices, box = this.box, node = this.node
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz
    const stack = new Uint32Array(128)
    let sp = 0
    stack[sp++] = 0
    let bestT = tMax, bestTri = -1, bu = 0, bv = 0
    while (sp) {
      const id = stack[--sp]
      const b = id * 6
      let t0 = (box[b] - ox) * ix, t1 = (box[b + 3] - ox) * ix
      if (t0 > t1) { const s = t0; t0 = t1; t1 = s }
      let u0 = (box[b + 1] - oy) * iy, u1 = (box[b + 4] - oy) * iy
      if (u0 > u1) { const s = u0; u0 = u1; u1 = s }
      if (u0 > t0) t0 = u0
      if (u1 < t1) t1 = u1
      let w0 = (box[b + 2] - oz) * iz, w1 = (box[b + 5] - oz) * iz
      if (w0 > w1) { const s = w0; w0 = w1; w1 = s }
      if (w0 > t0) t0 = w0
      if (w1 < t1) t1 = w1
      if (t0 > t1 || t1 < tMin || t0 > bestT) continue
      const a = node[id * 2], c = node[id * 2 + 1]
      if (c & 0x80000000) {
        const n = c & 0x7fffffff
        for (let k = a; k < a + n; k++) {
          const tri = this.order[k]
          const i0 = I[tri * 3] * 3, i1 = I[tri * 3 + 1] * 3, i2 = I[tri * 3 + 2] * 3
          const e1x = P[i1] - P[i0], e1y = P[i1 + 1] - P[i0 + 1], e1z = P[i1 + 2] - P[i0 + 2]
          const e2x = P[i2] - P[i0], e2y = P[i2 + 1] - P[i0 + 1], e2z = P[i2 + 2] - P[i0 + 2]
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
          const det = e1x * px + e1y * py + e1z * pz
          if (det > -1e-12 && det < 1e-12) continue
          const inv = 1 / det
          const sx = ox - P[i0], sy = oy - P[i0 + 1], sz = oz - P[i0 + 2]
          const u = (sx * px + sy * py + sz * pz) * inv
          if (u < 0 || u > 1) continue
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x
          const v = (dx * qx + dy * qy + dz * qz) * inv
          if (v < 0 || u + v > 1) continue
          const t = (e2x * qx + e2y * qy + e2z * qz) * inv
          if (t <= tMin || t >= bestT) continue
          if (accept && !accept(tri, t)) continue
          bestT = t
          bestTri = tri
          bu = u
          bv = v
        }
      } else {
        // near child last so it pops first
        const left = id + 1, right = a
        const dirNeg = (c === 0 ? dx : c === 1 ? dy : dz) < 0
        if (dirNeg) {
          stack[sp++] = left
          stack[sp++] = right
        } else {
          stack[sp++] = right
          stack[sp++] = left
        }
      }
    }
    return bestTri < 0 ? null : { t: bestT, tri: bestTri, u: bu, v: bv }
  }
}

/** Merges meshes into one soup with a per-triangle tag. */
export function mergeMeshes(parts: { positions: Float32Array; indices: Uint32Array; tag: number }[]) {
  let nv = 0, nt = 0
  for (const p of parts) {
    nv += p.positions.length / 3
    nt += p.indices.length / 3
  }
  const positions = new Float32Array(nv * 3)
  const indices = new Uint32Array(nt * 3)
  const tags = new Int32Array(nt)
  let vo = 0, to = 0
  for (const p of parts) {
    positions.set(p.positions, vo * 3)
    for (let i = 0; i < p.indices.length; i++) indices[to * 3 + i] = p.indices[i] + vo
    tags.fill(p.tag, to, to + p.indices.length / 3)
    vo += p.positions.length / 3
    to += p.indices.length / 3
  }
  return { positions, indices, tags }
}

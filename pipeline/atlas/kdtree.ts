// Static 3D k-d tree for filtered nearest-neighbour queries.

export class KdTree {
  private readonly p: Float32Array
  private readonly idx: Uint32Array
  // implicit tree: the range idx[lo, hi) is split at its middle element along axis[mid]
  private readonly axis: Uint8Array

  constructor(points: Float32Array) {
    this.p = points
    const n = points.length / 3
    this.idx = new Uint32Array(n)
    for (let i = 0; i < n; i++) this.idx[i] = i
    this.axis = new Uint8Array(n)
    this.build(0, n)
  }

  private build(lo: number, hi: number) {
    if (hi - lo <= 1) return
    const P = this.p, I = this.idx
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
    for (let i = lo; i < hi; i++) for (let k = 0; k < 3; k++) {
      const v = P[I[i] * 3 + k]
      if (v < mn[k]) mn[k] = v
      if (v > mx[k]) mx[k] = v
    }
    const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]]
    const ax = ext[0] > ext[1] ? (ext[0] > ext[2] ? 0 : 2) : ext[1] > ext[2] ? 1 : 2
    const mid = (lo + hi) >> 1
    this.select(lo, hi - 1, mid, ax)
    this.axis[mid] = ax
    this.build(lo, mid)
    this.build(mid + 1, hi)
  }

  // quickselect on idx[lo..hi] so idx[k] is the k-th smallest along ax
  private select(lo: number, hi: number, k: number, ax: number) {
    const P = this.p, I = this.idx
    while (hi > lo) {
      const pivot = P[I[(lo + hi) >> 1] * 3 + ax]
      let i = lo, j = hi
      while (i <= j) {
        while (P[I[i] * 3 + ax] < pivot) i++
        while (P[I[j] * 3 + ax] > pivot) j--
        if (i <= j) {
          const t = I[i]
          I[i] = I[j]
          I[j] = t
          i++
          j--
        }
      }
      if (k <= j) hi = j
      else if (k >= i) lo = i
      else return
    }
  }

  /** Nearest point within maxDist accepted by `accept`; returns [index, distance] or null. */
  nearest(x: number, y: number, z: number, maxDist: number, accept?: (i: number) => boolean): [number, number] | null {
    let best = -1, bestD2 = maxDist * maxDist
    const P = this.p, I = this.idx, A = this.axis
    const q = [x, y, z]
    const visit = (lo: number, hi: number) => {
      if (hi <= lo) return
      const mid = (lo + hi) >> 1
      const i = I[mid]
      const dx = P[i * 3] - x, dy = P[i * 3 + 1] - y, dz = P[i * 3 + 2] - z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 < bestD2 && (!accept || accept(i))) {
        bestD2 = d2
        best = i
      }
      if (hi - lo === 1) return
      const ax = A[mid]
      const diff = q[ax] - P[i * 3 + ax]
      if (diff < 0) {
        visit(lo, mid)
        if (diff * diff < bestD2) visit(mid + 1, hi)
      } else {
        visit(mid + 1, hi)
        if (diff * diff < bestD2) visit(lo, mid)
      }
    }
    visit(0, I.length)
    return best < 0 ? null : [best, Math.sqrt(bestD2)]
  }
}

import { Float32BufferAttribute, Vector3, type BufferGeometry, type Matrix4 } from 'three'

const DONE = new WeakSet<BufferGeometry>()

/** Prepares the hair shell once per geometry: writes its closeness to the open boundary into COLOR_0.g
 * (1 at the edge, 0 from `width` of the deepest point in; the hair shader thins the hair out with it) and gives
 * it crew-cut volume, pushing it out along the normals up to `top` metres on the crown and `side` elsewhere.
 * `dequant` maps the quantized positions to metres (Rig.dequant). */
export function prepareHair(geometry: BufferGeometry, dequant: Matrix4, { width = 0.12, top = 0.0055, side = 0.002 } = {}) {
  if (DONE.has(geometry)) return
  const nrm = geometry.getAttribute('normal')
  const color = geometry.getAttribute('color')
  const index = geometry.getIndex()
  const q = geometry.getAttribute('position')
  if (!q || !nrm || !color || !index) return
  DONE.add(geometry)
  // float copy in the same quantized frame: the volume grows past the integer range at the crown
  const pos = new Float32BufferAttribute(q.count * 3, 3)
  for (let i = 0; i < q.count; i++) pos.setXYZ(i, q.getX(i), q.getY(i), q.getZ(i))
  geometry.setAttribute('position', pos)
  const unit = dequant.getMaxScaleOnAxis()
  const n = pos.count
  // weld vertices split by UV seams, so only the true boundary counts
  const key = new Map<string, number>()
  const weld = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`
    let w = key.get(k)
    if (w === undefined) key.set(k, (w = key.size))
    weld[i] = w
  }
  const edges = new Map<string, number>()
  const adj: Map<number, number>[] = Array.from({ length: key.size }, () => new Map())
  const p = (i: number) => [pos.getX(i), pos.getY(i), pos.getZ(i)]
  const rep = new Int32Array(key.size)
  for (let i = 0; i < n; i++) rep[weld[i]] = i
  for (let t = 0; t < index.count; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = weld[index.getX(t + e)], b = weld[index.getX(t + ((e + 1) % 3))]
      const k = a < b ? `${a},${b}` : `${b},${a}`
      edges.set(k, (edges.get(k) ?? 0) + 1)
      const pa = p(rep[a]), pb = p(rep[b])
      const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])
      adj[a].set(b, d)
      adj[b].set(a, d)
    }
  }
  const dist = new Float64Array(key.size).fill(Infinity)
  for (const [k, c] of edges) if (c === 1) for (const v of k.split(',').map(Number)) dist[v] = 0
  // repeated relaxation; the shell is small
  for (let changed = true; changed; ) {
    changed = false
    for (let v = 0; v < key.size; v++) {
      for (const [u, d] of adj[v]) {
        if (dist[u] + d < dist[v] - 1e-9) {
          dist[v] = dist[u] + d
          changed = true
        }
      }
    }
  }
  let max = 0
  for (const d of dist) if (Number.isFinite(d)) max = Math.max(max, d)
  // width is a fraction of the deepest point, since positions may be quantized to arbitrary units
  const w = max * width
  const nv = new Vector3()
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, dist[weld[i]] / w)
    const inner = t * t * (3 - 2 * t)
    color.setY(i, 1 - inner)
    nv.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).normalize()
    const crown = Math.min(1, Math.max(0, (nv.y - 0.2) / 0.7))
    const off = (inner * (side + (top - side) * crown * crown)) / unit
    pos.setXYZ(i, pos.getX(i) + nv.x * off, pos.getY(i) + nv.y * off, pos.getZ(i) + nv.z * off)
  }
  color.needsUpdate = true
  pos.needsUpdate = true
}

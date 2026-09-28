import { BufferAttribute, type Material, type Mesh, type Object3D, type SkinnedMesh } from 'three'
import { skinnedPositions } from './props/fit'

// The shorts shell has no UVs of its own. Each shorts vertex takes the body UV of the closest point on the skin at rest,
// so the shorts shader can look up the atlas region under it (the glute tint, material.ts).

export const BODY_UV = 'bodyUv'

type P3 = [number, number, number]

/** closest point on triangle abc to p, as barycentric weights (Ericson, Real-Time Collision Detection 5.1.5) */
export function closestOnTriangle(p: P3, a: P3, b: P3, c: P3): P3 {
  const sub = (x: P3, y: P3): P3 => [x[0] - y[0], x[1] - y[1], x[2] - y[2]]
  const dot = (x: P3, y: P3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2]
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a)
  const d1 = dot(ab, ap), d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0]
  const bp = sub(p, b)
  const d3 = dot(ab, bp), d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0]
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return [1 - v, v, 0]
  }
  const cp = sub(p, c)
  const d5 = dot(ab, cp), d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1]
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return [1 - w, 0, w]
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return [0, 1 - w, w]
  }
  const den = 1 / (va + vb + vc)
  const v = vb * den, w = vc * den
  return [1 - v - w, v, w]
}

/**
 * For each xyz point of `from`, the uv of the closest point on the triangle mesh `to` (barycentric), searched over
 * the triangles round the body vertices within 1 cm of the nearest one.
 */
export function surfaceUv(from: Float32Array, to: Float32Array, toIndex: ArrayLike<number>, uv: ArrayLike<number>, cell = 0.02): Float32Array {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < from.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], from[i + k] - 0.15)
    hi[k] = Math.max(hi[k], from[i + k] + 0.15)
  }
  const dims = lo.map((l, k) => Math.max(1, Math.ceil((hi[k] - l) / cell)))
  const nv = to.length / 3
  const cellOf = new Int32Array(nv).fill(-1)
  const grid = new Map<number, number[]>()
  for (let j = 0; j < nv; j++) {
    let key = 0
    for (let k = 2; k >= 0; k--) {
      const x = to[j * 3 + k]
      if (x < lo[k] || x > hi[k]) {
        key = -1
        break
      }
      key = key * dims[k] + Math.min(dims[k] - 1, Math.floor((x - lo[k]) / cell))
    }
    if (key < 0) continue
    cellOf[j] = key
    let list = grid.get(key)
    if (!list) grid.set(key, (list = []))
    list.push(j)
  }
  const tris = new Map<number, number[]>()
  for (let t = 0; t < toIndex.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const j = toIndex[t + k]
      if (cellOf[j] < 0) continue
      let list = tris.get(j)
      if (!list) tris.set(j, (list = []))
      list.push(t)
    }
  }
  const out = new Float32Array((from.length / 3) * 2)
  const p: P3 = [0, 0, 0]
  const P = (j: number): P3 => [to[j * 3], to[j * 3 + 1], to[j * 3 + 2]]
  const dist2 = (j: number) => (to[j * 3] - p[0]) ** 2 + (to[j * 3 + 1] - p[1]) ** 2 + (to[j * 3 + 2] - p[2]) ** 2
  for (let i = 0; i < from.length / 3; i++) {
    p[0] = from[i * 3]
    p[1] = from[i * 3 + 1]
    p[2] = from[i * 3 + 2]
    const c = [0, 1, 2].map((k) => Math.min(dims[k] - 1, Math.floor((p[k] - lo[k]) / cell)))
    // vertices of the cells within r of p's cell, growing r until one is found (and one more ring for exactness)
    const gather = (r: number) => {
      const found: number[] = []
      for (let z = Math.max(0, c[2] - r); z <= Math.min(dims[2] - 1, c[2] + r); z++)
        for (let y = Math.max(0, c[1] - r); y <= Math.min(dims[1] - 1, c[1] + r); y++)
          for (let x = Math.max(0, c[0] - r); x <= Math.min(dims[0] - 1, c[0] + r); x++) {
            const list = grid.get(x + dims[0] * (y + dims[1] * z))
            if (list) for (const j of list) found.push(j)
          }
      return found
    }
    let r = 1, verts = gather(r)
    while (!verts.length && r < 8) verts = gather(++r)
    if (!verts.length) continue
    let dv = Infinity
    for (const j of verts) dv = Math.min(dv, dist2(j))
    dv = Math.sqrt(dv)
    if (dv > r * cell) verts = gather(Math.ceil(dv / cell) + 1)
    const reach = (dv + 0.01) ** 2
    let best = Infinity
    for (const j of verts) {
      if (dist2(j) > reach) continue
      for (const t of tris.get(j) ?? []) {
        const a = toIndex[t], b = toIndex[t + 1], cc = toIndex[t + 2]
        const w = closestOnTriangle(p, P(a), P(b), P(cc))
        let d = 0
        for (let k = 0; k < 3; k++) d += (w[0] * to[a * 3 + k] + w[1] * to[b * 3 + k] + w[2] * to[cc * 3 + k] - p[k]) ** 2
        if (d >= best) continue
        best = d
        out[i * 2] = w[0] * uv[a * 2] + w[1] * uv[b * 2] + w[2] * uv[cc * 2]
        out[i * 2 + 1] = w[0] * uv[a * 2 + 1] + w[1] * uv[b * 2 + 1] + w[2] * uv[cc * 2 + 1]
      }
    }
  }
  return out
}

/**
 * 1 for vertices of triangles that span a body UV seam (an edge far longer in UV than its body length suggests):
 * interpolating their UVs would sample unrelated parts of the atlas
 */
export function seamVertices(pos: Float32Array, uv: Float32Array, index: ArrayLike<number>, factor = 5): Uint8Array {
  const ratio: number[] = []
  const edge = (i: number, j: number) => Math.hypot(uv[i * 2] - uv[j * 2], uv[i * 2 + 1] - uv[j * 2 + 1]) / Math.max(1e-6, Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 1] - pos[j * 3 + 1], pos[i * 3 + 2] - pos[j * 3 + 2]))
  for (let t = 0; t < index.length; t += 3) for (let k = 0; k < 3; k++) ratio.push(edge(index[t + k], index[t + ((k + 1) % 3)]))
  const median = [...ratio].sort((a, b) => a - b)[ratio.length >> 1]
  const out = new Uint8Array(pos.length / 3)
  for (let t = 0; t < index.length; t += 3) {
    if ([0, 1, 2].some((k) => ratio[t + k] > factor * median)) for (let k = 0; k < 3; k++) out[index[t + k]] = 1
  }
  return out
}

const materialName = (m: Mesh) => (m.userData.figureMaterial as string | undefined) ?? (m.material as Material).name

/** adds bodyUv (u, v, seam flag) to the shorts geometry of a figure scene at rest (once per shared geometry) */
export function attachBodyUv(scene: Object3D) {
  let body: SkinnedMesh | undefined, shorts: SkinnedMesh | undefined
  scene.traverse((o) => {
    const m = o as SkinnedMesh
    if (!m.isSkinnedMesh) return
    if (materialName(m) === 'skin') body = m
    else if (materialName(m) === 'shorts') shorts = m
  })
  if (!body || !shorts || shorts.geometry.hasAttribute(BODY_UV)) return
  const uv = body.geometry.getAttribute('uv')
  const index = shorts.geometry.getIndex()
  const bodyIndex = body.geometry.getIndex()
  if (!uv || !index || !bodyIndex) return
  scene.updateMatrixWorld(true)
  const values = new Float32Array(uv.count * 2)
  for (let i = 0; i < uv.count; i++) {
    values[i * 2] = uv.getX(i)
    values[i * 2 + 1] = uv.getY(i)
  }
  const pos = skinnedPositions(shorts)
  const near = surfaceUv(pos, skinnedPositions(body), bodyIndex.array, values)
  const seam = seamVertices(pos, near, index.array)
  const out = new Float32Array(seam.length * 3)
  for (let i = 0; i < seam.length; i++) out.set([near[i * 2], near[i * 2 + 1], seam[i]], i * 3)
  shorts.geometry.setAttribute(BODY_UV, new BufferAttribute(out, 3))
}

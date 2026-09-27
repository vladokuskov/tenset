import { Box3, BufferGeometry, CylinderGeometry, Float32BufferAttribute, LatheGeometry, Matrix4, Quaternion, SphereGeometry, TorusGeometry, Vector2, Vector3 } from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { MatKey } from './materials'

// Parametric prop geometry as data: a prop is a list of pieces (shared geometry key, material key, matrix), so
// identical parts draw as one instanced mesh and the builders stay pure (testable in Node).

export type Piece = { geo: string; mat: MatKey; matrix: Matrix4 }
export type Vec = Vector3 | readonly [number, number, number]

export const vec = (v: Vec) => (v instanceof Vector3 ? v.clone() : new Vector3(v[0], v[1], v[2]))

const X = new Vector3(1, 0, 0)
const Y = new Vector3(0, 1, 0)
const Z = new Vector3(0, 0, 1)

const key = (kind: string, ...n: number[]) => [kind, ...n.map((x) => +x.toFixed(4))].join(':')

/** rounded-rectangle prism along Y (-0.5..0.5), cross-section w (X) by d (Z), smooth corners, flat ends */
function roundedPrism(w: number, d: number, r: number, seg = 3) {
  const prof: [number, number, number, number][] = []
  const corners: [number, number, number][] = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, 90], [-w / 2 + r, -d / 2 + r, 180], [w / 2 - r, -d / 2 + r, 270]]
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = ((a0 + (90 * i) / seg) * Math.PI) / 180
      prof.push([cx + r * Math.cos(a), cz + r * Math.sin(a), Math.cos(a), Math.sin(a)])
    }
  }
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []
  const n = prof.length
  for (let i = 0; i < n; i++) {
    const [x, z, nx, nz] = prof[i]
    pos.push(x, -0.5, z, x, 0.5, z)
    nor.push(nx, 0, nz, nx, 0, nz)
    uv.push(i / n, 0, i / n, 1)
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2
    idx.push(a, a + 1, b, b, a + 1, b + 1)
  }
  for (const y of [-0.5, 0.5]) {
    const c = pos.length / 3
    pos.push(0, y, 0)
    nor.push(0, Math.sign(y), 0)
    uv.push(0.5, 0.5)
    for (const [x, z] of prof) {
      pos.push(x, y, z)
      nor.push(0, Math.sign(y), 0)
      uv.push(x / w + 0.5, z / d + 0.5)
    }
    for (let i = 0; i < n; i++) {
      const a = c + 1 + i, b = c + 1 + ((i + 1) % n)
      if (y > 0) idx.push(c, b, a)
      else idx.push(c, a, b)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

/** a lathe profile (radius, height) revolved about Y */
const lathe = (pts: [number, number][], seg = 48) => new LatheGeometry(pts.map(([r, y]) => new Vector2(r, y)), seg)

/** iron plate: raised hub and rim, recessed web, chamfered edges; bore fits a 50 mm sleeve; y from 0 to w */
function plateProfile(R: number, w: number): [number, number][] {
  const rb = 0.026
  const rh = Math.min(0.075, R * 0.45)
  const c = Math.min(0.004, w * 0.1)
  const web = w * 0.22
  const rim = Math.min(0.024, R * 0.14)
  return [
    [rb, c], [rb + c, 0], [rh - c, 0], [rh, c], [rh + 0.008, web], [R - rim - 0.008, web], [R - rim, c], [R - rim + c, 0],
    [R - c * 1.5, 0], [R, c * 1.5], [R, w - c * 1.5], [R - c * 1.5, w], [R - rim + c, w], [R - rim, w - c], [R - rim - 0.008, w - web],
    [rh + 0.008, w - web], [rh, w - c], [rh - c, w], [rb + c, w], [rb, w - c], [rb, c],
  ]
}

/** grooved pulley wheel with a hub, y from 0 to w */
function wheelProfile(R: number, w: number): [number, number][] {
  const g = Math.min(0.008, R * 0.18)
  return [
    [0.006, 0], [R * 0.45, 0], [R * 0.5, w * 0.2], [R - 0.004, w * 0.2], [R, w * 0.25], [R, w * 0.32], [R - g, w * 0.5],
    [R, w * 0.68], [R, w * 0.75], [R - 0.004, w * 0.8], [R * 0.5, w * 0.8], [R * 0.45, w], [0.006, w],
  ]
}

/** knurled rod along Y centred: v runs 1 per 25 mm so the grip texture keeps its pitch at any length */
function knurlRod(r: number, len: number) {
  const g = new CylinderGeometry(r, r, len, 28, 1, true)
  const uv = g.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (len / 0.025))
  return g
}

function make(k: string): BufferGeometry {
  const [kind, ...s] = k.split(':')
  const n = s.map(Number)
  switch (kind) {
    case 'cyl': return new CylinderGeometry(1, 1, 1, n[0], 1)
    case 'tube': return roundedPrism(n[0], n[1], n[2])
    case 'rbox': return new RoundedBoxGeometry(n[0], n[1], n[2], 4, n[3])
    case 'sphere': return new SphereGeometry(1, 24, 16)
    case 'torus': return new TorusGeometry(n[0], n[1], 12, 40, n[2])
    case 'knurl': return knurlRod(n[0], n[1])
    case 'plate': return lathe(plateProfile(n[0], n[1]), 64)
    case 'wheel': return lathe(wheelProfile(n[0], n[1]), 40)
    case 'lathe': return lathe(JSON.parse(decodeURIComponent(s.join(':'))) as [number, number][], 40)
  }
  throw new Error(`unknown prop geometry ${k}`)
}

const cache = new Map<string, BufferGeometry>()

/** shared geometry for a key (never disposed: the set is small and reused by every prop) */
export function geometry(k: string): BufferGeometry {
  let g = cache.get(k)
  if (!g) {
    g = make(k)
    g.computeBoundingBox()
    cache.set(k, g)
  }
  return g
}

/** rotation taking +Y to `dir` */
export function alongY(dir: Vector3) {
  return new Quaternion().setFromUnitVectors(Y, dir.clone().normalize())
}

/** right-handed basis with Y along `dir` and X as close to `side` as possible */
function basis(dir: Vector3, side?: Vec) {
  const y = dir.clone().normalize()
  let s = side ? vec(side) : Math.abs(y.x) > 0.9 ? Z.clone() : X.clone()
  if (Math.abs(s.clone().normalize().dot(y)) > 0.999) s = Math.abs(y.x) > 0.9 ? Z.clone() : X.clone()
  const x = s.addScaledVector(y, -s.dot(y)).normalize()
  const z = new Vector3().crossVectors(x, y)
  return { x, y, z }
}

export type TubeOpts = {
  /** direction the tube's width (w) faces; the depth (d) is perpendicular to it and the axis */
  side?: Vec
  /** black plastic end plugs */
  cap?: 'both' | 'a' | 'b' | 'none'
  /** corner radius */
  r?: number
}

export class Kit {
  pieces: Piece[] = []

  add(geo: string, mat: MatKey, matrix: Matrix4) {
    this.pieces.push({ geo, mat, matrix })
    return this
  }

  /** everything in `other`, transformed by `m` */
  merge(other: { pieces: Piece[] }, m?: Matrix4) {
    for (const p of other.pieces) this.pieces.push({ geo: p.geo, mat: p.mat, matrix: m ? m.clone().multiply(p.matrix) : p.matrix.clone() })
    return this
  }

  /** round bar between two points */
  rod(a: Vec, b: Vec, r: number, mat: MatKey, seg = 32) {
    const A = vec(a), B = vec(b)
    const d = B.clone().sub(A)
    return this.add(key('cyl', seg), mat, new Matrix4().compose(A.lerp(B, 0.5), alongY(d), new Vector3(r, d.length(), r)))
  }

  /** knurled grip section between two points */
  knurl(a: Vec, b: Vec, r: number, mat: MatKey = 'grip') {
    const A = vec(a), B = vec(b)
    const d = B.clone().sub(A)
    return this.add(key('knurl', r, d.length()), mat, new Matrix4().compose(A.lerp(B, 0.5), alongY(d), new Vector3(1, 1, 1)))
  }

  /** rectangular steel tube (w x d) between two points */
  tube(a: Vec, b: Vec, w: number, d: number, mat: MatKey = 'frame', o: TubeOpts = {}) {
    const A = vec(a), B = vec(b)
    const axis = B.clone().sub(A)
    const len = axis.length()
    const { x, y, z } = basis(axis, o.side)
    const r = o.r ?? Math.min(w, d) * 0.18
    const m = new Matrix4().makeBasis(x, y, z)
    this.add(key('tube', w, d, r), mat, m.clone().scale(new Vector3(1, len, 1)).setPosition(A.clone().lerp(B, 0.5)))
    const cap = o.cap ?? 'none'
    const plug = (at: Vector3, s: number) =>
      this.add(key('tube', w - 0.004, d - 0.004, Math.max(0.001, r - 0.002)), 'rubber', m.clone().scale(new Vector3(1, 0.006, 1)).setPosition(at.clone().addScaledVector(y, s * 0.002)))
    if (cap === 'both' || cap === 'a') plug(A, -1)
    if (cap === 'both' || cap === 'b') plug(B, 1)
    return this
  }

  /** rounded box at `center`, optionally rotated */
  box(center: Vec, size: Vec, mat: MatKey, rot?: Quaternion, radius?: number) {
    const s = vec(size)
    const r = radius ?? Math.min(s.x, s.y, s.z) * 0.2
    return this.add(key('rbox', s.x, s.y, s.z, r), mat, new Matrix4().compose(vec(center), rot ?? new Quaternion(), new Vector3(1, 1, 1)))
  }

  /** a box whose local axes are given (x, y, z unit vectors) */
  boxBasis(center: Vec, size: Vec, mat: MatKey, x: Vector3, y: Vector3, radius?: number) {
    const z = new Vector3().crossVectors(x, y)
    return this.box(center, size, mat, new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z)), radius)
  }

  /** revolved shape from a registered key ('plate:R:w', 'wheel:R:w') with its Y axis along `axis`, starting at `at` */
  revolve(geo: string, at: Vec, axis: Vec, mat: MatKey) {
    return this.add(geo, mat, new Matrix4().compose(vec(at), alongY(vec(axis)), new Vector3(1, 1, 1)))
  }

  plate(at: Vec, axis: Vec, R: number, w: number, mat: MatKey = 'plate') {
    return this.revolve(key('plate', R, w), at, axis, mat)
  }

  /** pulley wheel centred at `c` spinning about `axle` */
  wheel(c: Vec, axle: Vec, R: number, w: number, mat: MatKey = 'pulley') {
    const A = vec(axle).normalize()
    return this.revolve(key('wheel', R, w), vec(c).addScaledVector(A, -w / 2), A, mat)
  }

  /** a custom lathe profile (radius, height), cached by its points */
  profile(pts: [number, number][], at: Vec, axis: Vec, mat: MatKey) {
    return this.revolve(`lathe:${encodeURIComponent(JSON.stringify(pts))}`, at, axis, mat)
  }

  sphere(c: Vec, r: number | Vec, mat: MatKey, rot?: Quaternion) {
    const s = typeof r === 'number' ? new Vector3(r, r, r) : vec(r)
    return this.add('sphere', mat, new Matrix4().compose(vec(c), rot ?? new Quaternion(), s))
  }

  /** ring of major radius R, tube radius r, around `normal`; `arc` < 2 pi draws an open ring starting at `start` */
  torus(c: Vec, R: number, r: number, normal: Vec, mat: MatKey, arc = Math.PI * 2, start?: Vec) {
    const n = vec(normal).normalize()
    const s = start ? vec(start) : Math.abs(n.x) > 0.9 ? Y.clone() : X.clone()
    const x = s.addScaledVector(n, -s.dot(n)).normalize()
    const y = new Vector3().crossVectors(n, x)
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, n))
    return this.add(key('torus', R, r, arc), mat, new Matrix4().compose(vec(c), q, new Vector3(1, 1, 1)))
  }

  /** flat dark disc on a surface (adjustment holes) */
  hole(c: Vec, normal: Vec, r = 0.009) {
    const n = vec(normal).normalize()
    return this.add(key('cyl', 12), 'hole', new Matrix4().compose(vec(c).addScaledVector(n, 0.0006), alongY(n), new Vector3(r, 0.0016, r)))
  }

  /** hex bolt head standing on a surface */
  bolt(c: Vec, normal: Vec, r = 0.009, mat: MatKey = 'frameDark') {
    const n = vec(normal).normalize()
    return this.add(key('cyl', 6), mat, new Matrix4().compose(vec(c).addScaledVector(n, r * 0.3), alongY(n), new Vector3(r, r * 0.6, r)))
  }

  /** pop-pin knob: short steel pin and a black ball knob pointing along `dir` */
  knob(c: Vec, dir: Vec, r = 0.018) {
    const C = vec(c), d = vec(dir).normalize()
    this.rod(C, C.clone().addScaledVector(d, r * 1.6), r * 0.35, 'steel', 16)
    return this.sphere(C.clone().addScaledVector(d, r * 2.2), new Vector3(r, r * 0.8, r), 'rubber', alongY(d))
  }
}

const corner = new Vector3()

/** bounding box of pieces from their geometry boxes */
export function piecesBox(pieces: Piece[], out = new Box3()) {
  out.makeEmpty()
  const b = new Box3()
  for (const p of pieces) {
    b.copy(geometry(p.geo).boundingBox!).applyMatrix4(p.matrix)
    out.union(b)
  }
  return out
}

/** the 8 corners of every piece's box (tight camera framing) */
export function piecesCorners(pieces: Piece[]) {
  const out: number[] = []
  for (const p of pieces) {
    const bb = geometry(p.geo).boundingBox!
    for (let k = 0; k < 8; k++) {
      corner.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(p.matrix)
      out.push(corner.x, corner.y, corner.z)
    }
  }
  return out
}

export type PropBuild<S> = { pieces: Piece[]; sockets: S; bbox: Box3 }

export function finish<S>(kit: Kit, sockets: S): PropBuild<S> {
  return { pieces: kit.pieces, sockets, bbox: piecesBox(kit.pieces) }
}

/** matrix from a position and optional rotation (tuples as used by src/motion, or three types) */
export function poseMatrix(pos: Vec, rot?: Quaternion | readonly [number, number, number, number]) {
  const q = !rot ? new Quaternion() : rot instanceof Quaternion ? rot : new Quaternion(rot[0], rot[1], rot[2], rot[3])
  return new Matrix4().compose(vec(pos), q, new Vector3(1, 1, 1))
}

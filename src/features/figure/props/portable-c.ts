import { Matrix4, Vector3 } from 'three'
import type { ImplementSpec, Part } from '../../../motion/implements.ts'
import { barbell } from '../../../motion/implements.ts'
import { abWheel, gymRing, landmine, landmineBar, ringAnchor, AB_WHEEL, LANDMINE, LANDMINE_V, RING, type RingAnchorSpec } from '../../../motion/implements/index.ts'
import type { V3 } from '../../../motion/math.ts'
import { buildBarbell } from './barbell.ts'
import { finish, Kit, type Piece, type PropBuild } from './kit.ts'
import { gripSocket, type GripSocket, type SurfaceSocket } from './sockets.ts'

// Tier C portable equipment drawn from its src/motion descriptors (implements/portable-c.ts): gymnastic rings, their
// straps and overhead anchor, the landmine base and bar, the ab wheel. Frames as in the descriptors.

type Cyl = Extract<Part, { shape: 'cylinder' }>
const cyls = (spec: ImplementSpec) => spec.parts.filter((p): p is Cyl => p.shape === 'cylinder')
const grips = (spec: ImplementSpec, names: string[]): Record<string, GripSocket> => Object.fromEntries(names.filter((n) => spec.sites[n]).map((n) => [n, gripSocket(spec.sites[n])]))
const v = (p: readonly number[]) => new Vector3(p[0], p[1], p[2])

// ---------- rings ----------

export type RingSockets = { grip: GripSocket; strap: Vector3 }

/** One gymnastic ring: a black ring in the XY plane, the strap point at the top. */
export function buildRing(spec: ImplementSpec = gymRing({ id: 'ring' })): PropBuild<RingSockets> {
  const kit = new Kit()
  kit.torus([0, 0, 0], RING.R, RING.r, [0, 0, 1], 'rubber')
  return finish(kit, { grip: gripSocket(spec.sites.grip), strap: v(spec.sites.strap.pos) })
}

/**
 * A ring strap pulled taut through world points: black webbing, its width along `side` (the ring's local X, so the
 * strap runs flat through the ring), a cam buckle 35 cm above the ring with the tail doubled back.
 */
export function drawRingStrap(kit: Kit, pts: V3[], side: V3 = [1, 0, 0]) {
  const { width: w, thick: t } = RING.strap
  for (let k = 0; k + 1 < pts.length; k++) {
    const A = v(pts[k]), B = v(pts[k + 1])
    if (A.distanceTo(B) < 1e-5) continue
    kit.tube(A, B, w, t, 'rope', { side, r: t * 0.4 })
  }
  const n = pts.length
  if (n < 2) return kit
  const ring = v(pts[n - 1]), up = v(pts[n - 2]).sub(ring)
  const len = up.length()
  if (len < 0.45) return kit
  up.divideScalar(len)
  const s = v(side), face = new Vector3().crossVectors(s, up).normalize()
  const buckle = ring.clone().addScaledVector(up, 0.35)
  kit.boxBasis(buckle.clone().addScaledVector(face, t), [w + 0.008, 0.05, 0.012], 'steel', s.clone().addScaledVector(up, -s.dot(up)).normalize(), up, 0.003)
  // the tail doubled back from the buckle
  kit.tube(buckle.clone().addScaledVector(face, 2.2 * t), buckle.clone().addScaledVector(face, 2.2 * t).addScaledVector(up, -0.16), w, t, 'rope', { side, r: t * 0.4 })
  return kit
}

export type RingAnchorSockets = { straps: Vector3[] }

/** Overhead ring anchor: a powder-coated crossbar with webbing loops at the strap points, on a rig of two uprights. */
export function buildRingAnchor(spec: RingAnchorSpec = ringAnchor()): PropBuild<RingAnchorSockets> {
  const kit = new Kit()
  const { beam: b, upright: u } = RING
  const box = spec.parts[0] as Extract<Part, { shape: 'box' }>
  const h = box.center[1], half = box.size[0] / 2
  kit.tube([-half, h, 0], [half, h, 0], b, b, 'frame', { cap: 'both', side: [0, 1, 0] })
  for (const k of ['strap_l', 'strap_r']) {
    const x = spec.sites[k].pos[0]
    kit.box([x, h, 0], [RING.strap.width, b + 0.008, b + 0.008], 'rope', undefined, 0.003)
  }
  if (spec.mount === 'rig') {
    for (const x of [u, -u]) {
      kit.tube([x, 0.012, 0], [x, h - b / 2, 0], b, b, 'frame')
      kit.box([x, 0.006, 0], [b + 0.02, 0.012, 0.9], 'frameDark', undefined, 0.004)
      for (const z of [0.36, -0.36]) kit.bolt([x, 0.012, z], [0, 1, 0], 0.011)
      for (let y = 0.6; y < h - 0.3; y += 0.12) kit.hole([x, y, b / 2 + 0.0005], [0, 0, 1], 0.008)
    }
  }
  return finish(kit, { straps: ['strap_l', 'strap_r'].map((k) => v(spec.sites[k].pos)) })
}

// ---------- landmine ----------

export type LandmineSockets = { pivot: Vector3 }

/** Landmine floor unit: a plate with four bolts, a short post and the socket the pivot ball sits in. */
export function buildLandmine(spec: ImplementSpec = landmine()): PropBuild<LandmineSockets> {
  const { base, post, socket, pivot } = LANDMINE
  const kit = new Kit()
  kit.box([0, base.thick / 2, 0], [base.size, base.thick, base.size], 'frameDark', undefined, 0.004)
  for (const x of [-1, 1]) for (const z of [-1, 1]) kit.bolt([x * base.size * 0.4, base.thick, z * base.size * 0.4], [0, 1, 0], 0.011)
  const top = pivot - socket.top
  kit.tube([0, base.thick, 0], [0, top - socket.h, 0], post, post, 'frame')
  kit.rod([0, top - socket.h, 0], [0, top, 0], socket.r, 'steelDark', 32)
  return finish(kit, { pivot: v(spec.sites.pivot.pos) })
}

export type LandmineBarSockets = { grips: Record<string, GripSocket>; tip: SurfaceSocket; spec: ImplementSpec }

const collarProfile = (r: number, w: number, inner: number): [number, number][] => [
  [inner, 0], [r - 0.003, 0], [r, 0.003], [r, w - 0.003], [r - 0.003, w], [inner, w],
]

/**
 * The landmine bar: the swivel sleeve on its pivot ball, an Olympic bar (drawn as the free barbell) with plates and a
 * lock collar on the free end, and the V-handle under the shaft when the descriptor has one.
 */
export function buildLandmineBar(p: { plateKg?: number; handle?: 'none' | 'v'; spec?: ImplementSpec } = {}): PropBuild<LandmineBarSockets> {
  const spec = p.spec ?? landmineBar({ plateKg: p.plateKg, handle: p.handle })
  const { sleeve, ball, barOffset } = LANDMINE
  const kit = new Kit()
  kit.sphere([0, 0, 0], ball, 'steelDark')
  kit.rod([ball * 0.6, 0, 0], [sleeve.from, 0, 0], sleeve.r * 0.6, 'steelDark', 24)
  kit.rod([sleeve.from, 0, 0], [sleeve.to - 0.012, 0, 0], sleeve.r, 'frame', 32)
  kit.profile(collarProfile(sleeve.r + 0.004, 0.012, sleeve.r - 0.008), [sleeve.to - 0.012, 0, 0], [1, 0, 0], 'frameDark')
  const mid = barOffset + 1.1
  kit.merge(buildBarbell({ spec: barbell({ gripWidth: 0.8, plateKg: 0 }) }), new Matrix4().makeTranslation(mid, 0, 0))
  const plates = cyls(spec).filter((c) => c.r >= 0.06)
  for (const c of plates) kit.plate(c.a, [1, 0, 0], c.r, c.b[0] - c.a[0])
  if (plates.length) kit.profile(collarProfile(0.037, 0.03, 0.025), [Math.max(...plates.map((c) => c.b[0])) + 0.002, 0, 0], [1, 0, 0], 'rubber')
  if (spec.sites.v_l) {
    const { neck, drop, half, r, gripR, grip } = LANDMINE_V
    const hx = spec.sites.v_l.pos[0]
    kit.torus([hx, 0, 0], 0.014 + r * 0.7, r * 0.6, [1, 0, 0], 'steelDark')
    kit.rod([hx, -0.014, 0], [hx, -neck, 0], r, 'steelDark', 20)
    kit.sphere([hx, -neck, 0], r, 'steelDark')
    for (const z of [half, -half]) {
      kit.rod([hx, -neck, 0], [hx - grip, -drop, z], r, 'steelDark', 20)
      kit.sphere([hx - grip, -drop, z], gripR, 'steelDark')
      kit.knurl([hx - grip, -drop, z], [hx + grip, -drop, z], gripR)
      kit.sphere([hx + grip, -drop, z], gripR, 'rubber')
    }
  }
  const t = spec.sites.tip
  return finish(kit, { grips: grips(spec, ['end', 'end_in', 'cup_l', 'cup_r', 'v_l', 'v_r']), tip: { position: v(t.pos), normal: new Vector3(1, 0, 0) }, spec })
}

// ---------- ab wheel ----------

/** tyre and hub profiles along the axle (radius, distance from the wheel's -X face) */
const TYRE: [number, number][] = [[0.07, 0], [0.081, 0.002], [0.087, 0.008], [0.09, 0.02], [0.09, 0.05], [0.087, 0.062], [0.081, 0.068], [0.07, 0.07]]
const HUB: [number, number][] = [[0.011, 0], [0.066, 0.006], [0.07, 0.01], [0.07, 0.06], [0.066, 0.064], [0.011, 0.07]]

export type AbWheelSockets = { grips: Record<string, GripSocket>; floor: SurfaceSocket }
export type AbWheelBuild = PropBuild<AbWheelSockets> & { wheel: Piece[]; fixed: Piece[] }

/**
 * Ab wheel: a rubber tyre on a light hub with five dark bores (they show the wheel turning), a steel axle and black
 * foam handles with end caps. `wheel` are the pieces that spin (`spinPieces`), `fixed` the axle and handles.
 */
export function buildAbWheel(spec: ImplementSpec = abWheel()): AbWheelBuild {
  const { width: w, axle, handle } = AB_WHEEL
  const wk = new Kit()
  wk.profile(TYRE.map(([r, y]) => [r, (y * w) / 0.07]), [-w / 2, 0, 0], [1, 0, 0], 'rubber')
  wk.profile(HUB.map(([r, y]) => [r, (y * w) / 0.07]), [-w / 2, 0, 0], [1, 0, 0], 'frame')
  for (let k = 0; k < 5; k++) {
    const a = (2 * Math.PI * k) / 5
    for (const s of [1, -1]) wk.hole([s * (w / 2 - 0.002), 0.04 * Math.cos(a), 0.04 * Math.sin(a)], [s, 0, 0], 0.011)
  }
  const fk = new Kit()
  fk.rod([-handle.from, 0, 0], [handle.from, 0, 0], axle, 'steel', 20)
  for (const s of [1, -1]) {
    fk.rod([s * handle.from, 0, 0], [s * (handle.to - 0.006), 0, 0], handle.r, 'pad', 24)
    fk.sphere([s * (handle.to - 0.006), 0, 0], [0.008, handle.r * 1.05, handle.r * 1.05], 'rubber')
    fk.rod([s * (handle.from - 0.004), 0, 0], [s * handle.from, 0, 0], handle.r * 1.1, 'rubber', 24)
  }
  const kit = new Kit().merge(wk).merge(fk)
  const f = spec.sites.floor
  return { ...finish(kit, { grips: grips(spec, ['l', 'r']), floor: { position: v(f.pos), normal: new Vector3(0, -1, 0) } }), wheel: wk.pieces, fixed: fk.pieces }
}

/** the wheel pieces turned by `spin` rad about the axle (local X) */
export function spinPieces(pieces: Piece[], spin: number): Piece[] {
  const r = new Matrix4().makeRotationX(spin)
  return pieces.map((p) => ({ geo: p.geo, mat: p.mat, matrix: r.clone().multiply(p.matrix) }))
}

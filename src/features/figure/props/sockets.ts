import { Vector3 } from 'three'

// Prop sockets (contact and grip frames) and shared dimensions, in each prop's own frame.

/** Generic adjustable bench. Frame: X = across, Y = up, Z = the way a seated user faces.
 * The back pad hinges at the rear edge of the seat and folds back towards -Z. */
export type BenchParams = {
  /** back pad angle above horizontal in degrees: 0 flat, 30 / 45 / 60 / 85 incline, negative decline */
  back?: number
  /** seat tilt in degrees (front edge up) */
  seat?: number
  /** seat pad top height (m) */
  height?: number
}

export const benchDefaults: Required<BenchParams> = { back: 0, seat: 0, height: 0.44 }

export const BENCH = {
  seat: { len: 0.32, width: 0.3, thick: 0.065 },
  back: { len: 0.8, width: 0.27, thick: 0.065 },
  railY: 0.13,
  // front stabiliser stays behind a seated user's heels
  frontZ: 0.28,
  rearZ: -0.72,
}

/** Sockets in the bench frame: seat and back pad surfaces (centre, outward normal) and the hinge. */
export function benchSockets(p: BenchParams = {}) {
  const o = { ...benchDefaults, ...p }
  const b = (o.back * Math.PI) / 180
  const hinge = new Vector3(0, o.height - BENCH.seat.thick, -BENCH.seat.len / 2)
  const along = new Vector3(0, Math.sin(b), -Math.cos(b))
  const normal = new Vector3(0, Math.cos(b), Math.sin(b))
  return {
    hinge,
    seat: { position: new Vector3(0, o.height, 0), normal: new Vector3(0, 1, 0) },
    back: { position: hinge.clone().addScaledVector(along, BENCH.back.len / 2 + 0.01).addScaledVector(normal, BENCH.back.thick), normal, along },
  }
}

export type DumbbellParams = {
  /** grip length between the collars (m) */
  handle?: number
  handleRadius?: number
  /** head radius and width (m); defaults look like a ~12 kg dumbbell */
  headRadius?: number
  headWidth?: number
}

export const dumbbellDefaults: Required<DumbbellParams> = { handle: 0.12, handleRadius: 0.0165, headRadius: 0.066, headWidth: 0.058 }

export const DUMBBELL_COLLAR = 0.014

/** Sockets in the dumbbell's frame: the grip centre, with the handle along +X. */
export function dumbbellSockets(p: DumbbellParams = {}) {
  const o = { ...dumbbellDefaults, ...p }
  return {
    grip: { position: new Vector3(0, 0, 0), axis: new Vector3(1, 0, 0) },
    length: o.handle + 2 * (DUMBBELL_COLLAR + o.headWidth),
    headRadius: o.headRadius,
  }
}

/** a grip point: handle centre under the hand, `axis` along the handle (little finger -> index, as src/motion Site.axis) */
export type GripSocket = { position: Vector3; axis: Vector3 }

/** a contact surface: centre on the surface, outward normal, optional extent (m) along `along` and across it */
export type SurfaceSocket = { position: Vector3; normal: Vector3; along?: Vector3; size?: [number, number] }

/** where a cable leaves its pulley: wheel centre, the tangent point it leaves from, unit direction towards the load */
export type CableSocket = { pulley: Vector3; exit: Vector3; direction: Vector3 }

export function gripSocket(site: { pos: readonly number[]; axis?: readonly number[] }): GripSocket {
  const a = site.axis ?? [1, 0, 0]
  return { position: new Vector3(site.pos[0], site.pos[1], site.pos[2]), axis: new Vector3(a[0], a[1], a[2]).normalize() }
}

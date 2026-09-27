import { Matrix4, Quaternion, Vector3 } from 'three'
import { vec, type Kit, type Vec } from './kit.ts'

// Machine building blocks shared by the stack machines and racks.

export const CABLE_R = 0.0028
export const WHEEL_R = 0.045
const WHEEL_W = 0.022

export const up = () => new Vector3(0, 1, 0)

/** rubber floor pad under a frame foot */
export function foot(kit: Kit, at: Vec, w = 0.08, d = 0.07) {
  const p = vec(at)
  kit.box([p.x, 0.008, p.z], [w, 0.016, d], 'rubber', undefined, 0.005)
}

export type StackOpts = {
  /** plates in the stack */
  plates?: number
  /** how far the selected plates are lifted (m) */
  lift?: number
  /** plates riding with the top plate when lifted (the pin sits under the last one) */
  selected?: number
  /** guide rod top height */
  top: number
}

const PLATE = { w: 0.28, h: 0.024, d: 0.13, gap: 0.002 }

/** Selectorized weight stack centred on (x, z) of `base` (y = floor): guide rods, bumpers, plates, top plate, pin.
 * Returns the cable attachment point on top. */
export function weightStack(kit: Kit, base: Vec, o: StackOpts) {
  const b = vec(base)
  const n = o.plates ?? 14
  const sel = Math.min(n, o.selected ?? 6)
  const lift = o.lift ?? 0
  for (const s of [-1, 1]) {
    kit.rod([b.x + s * 0.1, 0.05, b.z], [b.x + s * 0.1, o.top, b.z], 0.011, 'steel', 20)
    kit.rod([b.x + s * 0.1, 0.05, b.z], [b.x + s * 0.1, 0.1, b.z], 0.024, 'rubber', 24)
  }
  let y = 0.1
  const plateY: number[] = []
  for (let i = 0; i < n; i++) {
    plateY.push(y)
    y += PLATE.h + PLATE.gap
  }
  const top = n - sel
  for (let i = 0; i < n; i++) {
    const dy = i >= top ? lift : 0
    kit.box([b.x, plateY[i] + PLATE.h / 2 + dy, b.z], [PLATE.w, PLATE.h, PLATE.d], 'stack', undefined, 0.004)
  }
  const tp = y + lift
  kit.box([b.x, tp + 0.02, b.z], [PLATE.w + 0.01, 0.04, PLATE.d + 0.01], 'frameDark', undefined, 0.006)
  kit.rod([b.x, tp + 0.04, b.z], [b.x, tp + 0.07, b.z], 0.012, 'steel', 20)
  kit.knob([b.x + 0.05, plateY[top] + PLATE.h / 2 + lift, b.z + PLATE.d / 2], [0, 0, 1], 0.014)
  return new Vector3(b.x, tp + 0.07, b.z)
}

/** straight cable run between points */
export function cableRun(kit: Kit, pts: Vec[]) {
  for (let i = 0; i + 1 < pts.length; i++) kit.rod(pts[i], pts[i + 1], CABLE_R, 'cable', 8)
}

/** pulley wheel with its two cheek plates, spinning about `axle` */
export function pulley(kit: Kit, c: Vec, axle: Vec, R = WHEEL_R) {
  const C = vec(c), a = vec(axle).normalize()
  kit.wheel(C, a, R, WHEEL_W)
  kit.rod(C.clone().addScaledVector(a, -0.02), C.clone().addScaledVector(a, 0.02), 0.007, 'steel', 12)
  for (const s of [-1, 1]) {
    const c0 = C.clone().addScaledVector(a, s * 0.0145)
    kit.rod(c0, c0.clone().addScaledVector(a, s * 0.005), R + 0.01, 'frameDark', 40)
  }
}

/**
 * Where a cable leaves a wheel towards `load`. The wheel (centre `c`, radius R) lies in the vertical plane through
 * `h` (horizontal unit vector); `wrap` is the direction the cable runs round the wheel, seen with `h` to the right.
 */
export function cableExit(c: Vector3, R: number, load: Vector3, h: Vector3, wrap: 'cw' | 'ccw') {
  const e = load.clone().sub(c)
  const ph = e.dot(h), pv = e.y
  const d = Math.hypot(ph, pv)
  const phi = Math.atan2(pv, ph) + (wrap === 'cw' ? 1 : -1) * Math.acos(Math.min(1, R / Math.max(d, R)))
  const exit = c.clone().addScaledVector(h, R * Math.cos(phi)).addScaledVector(up(), R * Math.sin(phi))
  return { exit, direction: load.clone().sub(exit).normalize() }
}

/** horizontal unit vector from `a` towards `b`, or `fallback` when b is (nearly) straight above or below */
export function horizontalTowards(a: Vector3, b: Vector3, fallback = new Vector3(0, 0, 1)) {
  const h = new Vector3(b.x - a.x, 0, b.z - a.z)
  return h.length() < 0.01 ? fallback.clone() : h.normalize()
}

/** rotation for a hanging cable attachment: local +Y towards the pulley, local X as close to world X as possible */
export function hangingRotation(towardsPulley: Vector3) {
  const y = towardsPulley.clone().normalize()
  const x = new Vector3(1, 0, 0)
  if (Math.abs(x.dot(y)) > 0.95) x.set(0, 0, 1)
  x.addScaledVector(y, -x.dot(y)).normalize()
  const z = new Vector3().crossVectors(x, y)
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))
}

/** row of adjustment holes on a tube face */
export function holeRow(kit: Kit, x: number, z: number, normal: Vec, from: number, to: number, step: number, r = 0.0085) {
  for (let y = from; y <= to + 1e-6; y += step) kit.hole([x, y, z], normal, r)
}

// Small vector/quaternion/matrix kit. Tuples, no classes, no renderer types.
// Quaternions are [x, y, z, w]. Mat3 is row-major, length 9.

export type V3 = [number, number, number]
export type Quat = [number, number, number, number]
export type Mat3 = number[]

export const DEG = Math.PI / 180
export const RAD = 180 / Math.PI

export const X: V3 = [1, 0, 0]
export const Y: V3 = [0, 1, 0]
export const Z: V3 = [0, 0, 1]

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z]
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
export const addScaled = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
export const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]]

export function norm(a: V3): V3 {
  const l = len(a)
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}

/** component of a perpendicular to unit axis n */
export const reject = (a: V3, n: V3): V3 => addScaled(a, n, -dot(a, n))

/** angle between two vectors, radians */
export function angleBetween(a: V3, b: V3) {
  return Math.atan2(len(cross(a, b)), dot(a, b))
}

/** signed angle from a to b about unit axis n, radians */
export function signedAngle(a: V3, b: V3, n: V3) {
  return Math.atan2(dot(cross(a, b), n), dot(a, b))
}

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

// quaternions

export const qid = (): Quat => [0, 0, 0, 1]

export function qaxis(axis: V3, rad: number): Quat {
  const n = norm(axis)
  const s = Math.sin(rad / 2)
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(rad / 2)]
}

export function qmul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

export const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]]

export function qnorm(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3])
  return l > 1e-12 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : qid()
}

export function qrot(q: Quat, v: V3): V3 {
  const [x, y, z, w] = q
  const tx = 2 * (y * v[2] - z * v[1])
  const ty = 2 * (z * v[0] - x * v[2])
  const tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}

export const qdot = (a: Quat, b: Quat) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]

/** rotation angle of q, radians in [0, pi] */
export function qangle(q: Quat) {
  return 2 * Math.atan2(Math.hypot(q[0], q[1], q[2]), Math.abs(q[3]))
}

/** angle between two orientations, radians */
export const qdiff = (a: Quat, b: Quat) => qangle(qmul(qconj(a), b))

/** rotation vector (axis * angle, radians), shortest arc */
export function qlog(q: Quat): V3 {
  const s = q[3] < 0 ? -1 : 1
  const x = q[0] * s, y = q[1] * s, z = q[2] * s, w = q[3] * s
  const sn = Math.hypot(x, y, z)
  if (sn < 1e-12) return [2 * x, 2 * y, 2 * z]
  const a = 2 * Math.atan2(sn, w)
  return [(x / sn) * a, (y / sn) * a, (z / sn) * a]
}

export function qexp(r: V3): Quat {
  const a = len(r)
  if (a < 1e-12) return qnorm([r[0] / 2, r[1] / 2, r[2] / 2, 1])
  return qaxis(r, a)
}

/** fraction t of q's rotation about the same axis */
export const qpow = (q: Quat, t: number): Quat => qexp(scale(qlog(q), t))

export function qslerp(a: Quat, b: Quat, t: number): Quat {
  let d = qdot(a, b)
  const bb: Quat = d < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b
  d = Math.abs(d)
  if (d > 0.9995) return qnorm([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t])
  const th = Math.acos(d)
  const s = Math.sin(th)
  const wa = Math.sin((1 - t) * th) / s
  const wb = Math.sin(t * th) / s
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb]
}

/** shortest rotation taking unit a to unit b */
export function qfromTo(a: V3, b: V3): Quat {
  const d = dot(a, b)
  if (d < -0.999999) {
    let axis = cross(X, a)
    if (len(axis) < 1e-6) axis = cross(Y, a)
    return qaxis(axis, Math.PI)
  }
  const c = cross(a, b)
  return qnorm([c[0], c[1], c[2], 1 + d])
}

/** q = swing * twist, twist about unit axis (both expressed in q's frame) */
export function swingTwist(q: Quat, axis: V3): { swing: Quat; twist: Quat } {
  const p = dot([q[0], q[1], q[2]], axis)
  let twist: Quat = [axis[0] * p, axis[1] * p, axis[2] * p, q[3]]
  const l = Math.hypot(twist[0], twist[1], twist[2], twist[3])
  twist = l < 1e-9 ? qid() : [twist[0] / l, twist[1] / l, twist[2] / l, twist[3] / l]
  return { swing: qmul(q, qconj(twist)), twist }
}

/** signed twist angle of q about unit axis, radians in (-pi, pi] */
export function twistAngle(q: Quat, axis: V3) {
  let { twist } = swingTwist(q, axis)
  if (twist[3] < 0) twist = [-twist[0], -twist[1], -twist[2], -twist[3]]
  return 2 * Math.atan2(dot([twist[0], twist[1], twist[2]], axis), twist[3])
}

// matrices

export function qtoMat(q: Quat): Mat3 {
  const [x, y, z, w] = q
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ]
}

export function qfromMat(m: Mat3): Quat {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m
  const tr = m00 + m11 + m22
  let q: Quat
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1)
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
  }
  return qnorm(q)
}

/** rotation whose columns are the images of X, Y, Z (orthonormalized, x kept exact) */
export function qfromBasis(x: V3, y: V3): Quat {
  const xn = norm(x)
  const zn = norm(cross(xn, y))
  const yn = cross(zn, xn)
  return qfromMat([xn[0], yn[0], zn[0], xn[1], yn[1], zn[1], xn[2], yn[2], zn[2]])
}

/** rotation taking the frame (a1, a2) onto (b1, b2); first vectors match exactly */
export function qalign(a1: V3, a2: V3, b1: V3, b2: V3): Quat {
  return qmul(qfromBasis(b1, b2), qconj(qfromBasis(a1, a2)))
}

export type Axis = 0 | 1 | 2

/**
 * Intrinsic Tait-Bryan decomposition: q = R(i, a) * R(j, b) * R(k, c) about principal axes.
 * Returns radians. Middle angle is in [-pi/2, pi/2].
 */
export function eulerFrom(q: Quat, i: Axis, j: Axis, k: Axis): V3 {
  const m = qtoMat(q)
  const r = (row: number, col: number) => m[row * 3 + col]
  const e = (j - i + 3) % 3 === 1 ? 1 : -1
  const b = Math.asin(clamp(e * r(i, k), -1, 1))
  const a = Math.atan2(-e * r(j, k), r(k, k))
  const c = Math.atan2(-e * r(i, j), r(i, i))
  return [a, b, c]
}

const PRINCIPAL: V3[] = [X, Y, Z]

export function eulerTo(i: Axis, j: Axis, k: Axis, a: number, b: number, c: number): Quat {
  return qmul(qmul(qaxis(PRINCIPAL[i], a), qaxis(PRINCIPAL[j], b)), qaxis(PRINCIPAL[k], c))
}

/** wrap degrees to (-180, 180] */
export function wrapDeg(a: number) {
  let x = a % 360
  if (x <= -180) x += 360
  if (x > 180) x -= 360
  return x
}

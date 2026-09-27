import {
  add, addScaled, clamp, cross, DEG, eulerFrom, len, norm, qaxis, qconj, qfromBasis, qmul, qrot, RAD, reject, scale, sub,
  twistAngle, wrapDeg, Y, Z, type Axis, type Quat, type V3,
} from './math.ts'
import { swingAxis, type JointRt, type Side, type Skeleton } from './skeleton.ts'

export type TwoBoneOptions = {
  /** smallest mid-joint flexion (deg); reach beyond it is softly clamped so straight limbs never pop */
  minFlex?: number
  /** width of the soft zone above minFlex (deg) */
  soft?: number
  /** extra rotation of the bend plane about the root->target axis (deg) */
  swivel?: number
}

export type TwoBone = {
  mid: V3
  /** end point actually reached (equals the target unless clamped) */
  end: V3
  /** mid-joint flexion, deg (0 = straight) */
  flex: number
  /** unit direction the mid joint bends towards, perpendicular to root->end */
  pole: V3
  /** hinge axis: rotating the upper direction about it by +flex gives the lower direction */
  hinge: V3
  /** distance still missing to the target, metres */
  shortfall: number
}

const flexAtDistance = (l1: number, l2: number, d: number) => 180 - Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1)) * RAD
const distanceAtFlex = (l1: number, l2: number, flexDeg: number) => Math.sqrt(l1 * l1 + l2 * l2 + 2 * l1 * l2 * Math.cos(flexDeg * DEG))

/**
 * Analytic two-bone IK. The bend plane contains root->target and `pole`, optionally rotated by `swivel` about the
 * axis. Near full reach the distance is compressed with tanh so flexion approaches minFlex smoothly (C1) instead of
 * snapping; the bend plane comes from the pole, not from the (degenerate) limb, so it stays put when straight.
 */
export function twoBone(root: V3, target: V3, l1: number, l2: number, pole: V3, o: TwoBoneOptions = {}): TwoBone {
  const minFlex = o.minFlex ?? 2
  const soft = o.soft ?? 8
  const toT = sub(target, root)
  const d0 = len(toT)
  const axis = d0 > 1e-9 ? scale(toT, 1 / d0) : norm(pole)
  const dMax = distanceAtFlex(l1, l2, minFlex)
  const dSoft = distanceAtFlex(l1, l2, minFlex + soft)
  const dMin = Math.abs(l1 - l2) + 1e-6
  let d = d0
  if (d > dSoft) d = dSoft + (dMax - dSoft) * Math.tanh((d - dSoft) / (dMax - dSoft))
  if (d < dMin) d = dMin
  let p = reject(pole, axis)
  if (len(p) < 1e-6) p = reject(Math.abs(axis[1]) < 0.9 ? Y : Z, axis)
  p = norm(p)
  if (o.swivel) p = qrot(qaxis(axis, o.swivel * DEG), p)
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)
  const a = Math.acos(cosA)
  const mid = add(root, add(scale(axis, l1 * cosA), scale(p, l1 * Math.sin(a))))
  const end = addScaled(root, axis, d)
  return { mid, end, flex: flexAtDistance(l1, l2, d), pole: p, hinge: norm(cross(p, axis)), shortfall: Math.max(0, d0 - d) }
}

/** world rotation of an upper limb segment from IK: local -Y along the limb, the hinge on `hingeLocal` */
export function limbRotation(root: V3, mid: V3, hinge: V3, hingeLocal: V3): Quat {
  const down = norm(sub(mid, root))
  // hingeLocal is +X or -X in canonical frames
  const xImage = hingeLocal[0] > 0 ? hinge : scale(hinge, -1)
  return qfromBasis(xImage, scale(down, -1))
}

// ---------- joint angles from relative rotations ----------

function principal(a: V3): { i: Axis; s: number } {
  const k = Math.abs(a[0]) > 0.5 ? 0 : Math.abs(a[1]) > 0.5 ? 1 : 2
  return { i: k as Axis, s: Math.sign(a[k]) }
}

/**
 * Euler-type joint DOFs (deg) from the joint's local rotation. Joints with fewer than three DOFs report the
 * leftover rotation about the missing axis as `residual` (deg).
 */
export function eulerAngles(skel: Skeleton, joint: JointRt, rel: Quat): { values: number[]; residual: number } {
  const axes = joint.dofs.map((i) => principal(skel.dofs[i].axis))
  const used = new Set(axes.map((a) => a.i))
  const free = ([0, 1, 2] as Axis[]).filter((k) => !used.has(k))
  const seq = [...axes.map((a) => a.i), ...free].slice(0, 3) as Axis[]
  const e = eulerFrom(rel, seq[0], seq[1], seq[2])
  const values = axes.map((a, n) => (e[n] * RAD) / a.s)
  let residual = 0
  for (let n = axes.length; n < 3; n++) residual = Math.max(residual, Math.abs(e[n] * RAD))
  return { values, residual }
}

/**
 * Humerothoracic swing-twist angles from the humerus rotation relative to the thorax.
 * `hint` is the plane to keep when the arm is nearly vertical (plane undefined).
 */
export function shoulderAngles(rel: Quat, side: Side, hint = 0): { plane: number; elev: number; rot: number } {
  const d = qrot(rel, [0, -1, 0])
  const m: V3 = side === 'l' ? d : [-d[0], d[1], d[2]]
  const elev = Math.acos(clamp(-m[1], -1, 1))
  let plane = hint
  if (Math.sin(elev) > 0.02) {
    plane = Math.atan2(m[2], m[0]) * RAD
    plane = hint + wrapDeg(plane - hint)
  }
  const swing = qaxis(swingAxis(plane, side), elev)
  const rotAxis: V3 = side === 'l' ? [0, -1, 0] : [0, 1, 0]
  const rot = twistAngle(qmul(qconj(swing), rel), rotAxis) * RAD
  return { plane, elev: elev * RAD, rot }
}

// ---------- damped least squares ----------

export type DlsOptions = { iters?: number; tol?: number; lambda?: number; h?: number; lo?: number[]; hi?: number[] }

/** Levenberg-Marquardt style damped least squares with forward-difference Jacobian; small problems only. */
export function dls(residual: (x: number[]) => number[], x0: number[], o: DlsOptions = {}): { x: number[]; err: number; iters: number } {
  const iters = o.iters ?? 30
  const tol = o.tol ?? 1e-7
  const h = o.h ?? 1e-5
  let lambda = o.lambda ?? 1e-3
  const bound = (x: number[]) => x.map((v, i) => clamp(v, o.lo?.[i] ?? -Infinity, o.hi?.[i] ?? Infinity))
  let x = bound(x0.slice())
  let r = residual(x)
  let err = Math.hypot(...r)
  let k = 0
  for (; k < iters && err > tol; k++) {
    const n = x.length, m = r.length
    const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0))
    for (let j = 0; j < n; j++) {
      const xp = x.slice()
      xp[j] += h
      const rp = residual(xp)
      for (let i = 0; i < m; i++) J[i][j] = (rp[i] - r[i]) / h
    }
    const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
    const g = new Array(n).fill(0)
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) for (let i = 0; i < m; i++) A[a][b] += J[i][a] * J[i][b]
      for (let i = 0; i < m; i++) g[a] -= J[i][a] * r[i]
    }
    let improved = false
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const M = A.map((row, a) => row.map((v, b) => v + (a === b ? lambda * (1 + A[a][a]) : 0)))
      const step = solve(M, g)
      const xn = bound(x.map((v, i) => v + step[i]))
      const rn = residual(xn)
      const en = Math.hypot(...rn)
      if (en < err) {
        x = xn
        r = rn
        err = en
        lambda = Math.max(lambda / 3, 1e-9)
        improved = true
      } else lambda *= 4
    }
    if (!improved) break
  }
  return { x, err, iters: k }
}

/** Gaussian elimination with partial pivoting */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    const piv = M[c][c] || 1e-12
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / piv
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / (M[r][r] || 1e-12)
  }
  return x
}


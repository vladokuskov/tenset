import { fk, type FK } from './fk.ts'
import { eulerAngles, hingeIK, limbRotation, shoulderAngles, twoBone } from './ik.ts'
import {
  add, clamp, cross, DEG, dist, dot, eulerFrom, len, norm, qalign, qaxis, qconj, qmul, qrot, RAD, reject, scale, sub,
  type Axis, type Quat, type V3,
} from './math.ts'
import { hingeRotation, shoulderRhythm, type Side, type Skeleton } from './skeleton.ts'

// ---------- 1-D root finding (balance) ----------

export type Root1d = { x: number; fx: number; bracketed: boolean }

/** Root of f on [lo, hi]: scans for a sign change, then Illinois regula falsi. Falls back to the smallest |f|. */
export function root1d(f: (x: number) => number, lo: number, hi: number, o: { tol?: number; iters?: number; scan?: number } = {}): Root1d {
  const tol = o.tol ?? 1e-6
  const scan = o.scan ?? 12
  let a = lo, fa = f(lo)
  let b = NaN, fb = NaN
  let best = { x: lo, fx: fa }
  for (let i = 1; i <= scan; i++) {
    const x = lo + ((hi - lo) * i) / scan
    const fx = f(x)
    if (Math.abs(fx) < Math.abs(best.fx)) best = { x, fx }
    if (Math.sign(fx) !== Math.sign(fa) || fx === 0) {
      b = x
      fb = fx
      break
    }
    a = x
    fa = fx
  }
  if (Number.isNaN(b)) return { ...best, bracketed: false }
  let side = 0
  let c = a, fc = fa
  for (let k = 0; k < (o.iters ?? 60); k++) {
    c = (a * fb - b * fa) / (fb - fa)
    fc = f(c)
    if (Math.abs(fc) < tol || Math.abs(b - a) < tol * 1e-3) break
    if (Math.sign(fc) === Math.sign(fb)) {
      b = c
      fb = fc
      if (side === -1) fa /= 2
      side = -1
    } else {
      a = c
      fa = fc
      if (side === 1) fb /= 2
      side = 1
    }
  }
  return { x: c, fx: fc, bracketed: true }
}

/**
 * Balance: find the value of one DOF (via `apply`, which re-solves whatever depends on it) that puts
 * `measure()` (e.g. bar or COM forward coordinate) on `target`.
 */
export function balanceDof(
  skel: Skeleton,
  q: Float64Array,
  dof: string,
  range: [number, number],
  measure: (q: Float64Array) => number,
  target: number,
  apply?: (q: Float64Array) => void,
): Root1d {
  const i = skel.dof[dof]
  const r = root1d((v) => {
    q[i] = v
    apply?.(q)
    return measure(q) - target
  }, range[0], range[1])
  q[i] = r.x
  apply?.(q)
  return r
}

// ---------- limits ----------

export type Violation = { dof: string; value: number; min: number; max: number }

export function limitViolations(skel: Skeleton, q: ArrayLike<number>, tol = 0): Violation[] {
  const out: Violation[] = []
  for (const d of skel.dofs) {
    const v = q[d.index]
    if (v < d.min - tol || v > d.max + tol) out.push({ dof: d.name, value: v, min: d.min, max: d.max })
  }
  return out
}

export function clampLimits(skel: Skeleton, q: Float64Array, names?: string[]) {
  for (const d of skel.dofs) if (!names || names.includes(d.name)) q[d.index] = clamp(q[d.index], d.min, d.max)
}

/** keep lumbar and thoracic flexion within +-band of a neutral reference (deg) */
export function spineBand(skel: Skeleton, q: Float64Array, band = 10, ref: { lumbar?: number; thorax?: number } = {}) {
  for (const [dof, r] of [['lumbar.flex', ref.lumbar ?? 0], ['thorax.flex', ref.thorax ?? 0]] as const) {
    const i = skel.dof[dof]
    q[i] = clamp(q[i], r - band, r + band)
  }
}

// ---------- planted feet ----------

export type FootTarget = { side: Side; rot: Quat; ankle: V3 }

/** foot flat on the floor with its midfoot site at `spot` (y ignored), turned out by toeOut deg */
export function plantFoot(skel: Skeleton, side: Side, spot: V3, toeOut = 0, floor = 0): FootTarget {
  const rot = qaxis([0, 1, 0], (side === 'l' ? toeOut : -toeOut) * DEG)
  const mid = skel.data.sites[`midfoot_${side}`].local
  const ankle = sub([spot[0], floor, spot[2]], qrot(rot, mid))
  return { side, rot, ankle }
}

export type LegSolve = { hip: number[]; knee: number; ankle: number[]; residual: number; shortfall: number; femur: Quat; tibia: Quat; kneePos: V3 }

const KNEE_AXIS: V3 = [1, 0, 0]

/** Leg IK to a planted foot. The knee bends in the plane of hip->ankle and the foot direction (knee over toes). */
export function legKinematics(skel: Skeleton, side: Side, hip: V3, pelvisRot: Quat, foot: FootTarget, minFlex = 0.5): LegSolve {
  const lt = skel.segments[skel.seg[`femur_${side}`]].length
  const ls = skel.segments[skel.seg[`tibia_${side}`]].length
  const toes = qrot(foot.rot, [0, 0, 1])
  const ik = twoBone(hip, foot.ankle, lt, ls, toes, { minFlex, soft: 2 })
  const femur = limbRotation(hip, ik.mid, ik.hinge, KNEE_AXIS)
  const tibia = qmul(femur, qaxis(KNEE_AXIS, ik.flex * DEG))
  const h = eulerAngles(skel, jointByName(skel, `hip_${side}`), qmul(qconj(pelvisRot), femur))
  const a = eulerAngles(skel, jointByName(skel, `ankle_${side}`), qmul(qconj(tibia), foot.rot))
  return { hip: h.values, knee: ik.flex, ankle: a.values, residual: a.residual, shortfall: ik.shortfall, femur, tibia, kneePos: ik.mid }
}

export function writeLeg(skel: Skeleton, q: Float64Array, side: Side, leg: LegSolve) {
  const d = skel.dof
  q[d[`hip_${side}.flex`]] = leg.hip[0]
  q[d[`hip_${side}.abd`]] = leg.hip[1]
  q[d[`hip_${side}.rot`]] = leg.hip[2]
  q[d[`knee_${side}.flex`]] = leg.knee
  q[d[`ankle_${side}.df`]] = leg.ankle[0]
  q[d[`ankle_${side}.inv`]] = leg.ankle[1]
}

/** solve both legs to their planted feet from the current pelvis; returns the worst shortfall (m) */
export function solveLegs(skel: Skeleton, q: Float64Array, feet: FootTarget[], minFlex = 0.5): number {
  const f = fk(skel, q)
  const pelvisRot = f.rot[skel.seg.pelvis]
  let worst = 0
  for (const foot of feet) {
    const leg = legKinematics(skel, foot.side, f.pos[skel.seg[`femur_${foot.side}`]], pelvisRot, foot, minFlex)
    writeLeg(skel, q, foot.side, leg)
    worst = Math.max(worst, leg.shortfall)
  }
  return worst
}

// ---------- hands on implements ----------

export type GripTarget = {
  pos: V3
  /** handle direction; the hand's pinky-to-index line aligns with it (sign picked from `palm`) */
  axis: V3
  /** rough world direction the palm should face */
  palm: V3
  /** fixed hand orientation instead of the free roll about the handle */
  hand?: Quat
  /**
   * how much flatter than the power-grip crease the handle crosses the palm, deg: the index end moves towards the
   * wrist. A bar held more in the fingers (overhead and wide grips) sits flatter, which takes radial deviation out.
   */
  oblique?: number
}

export type WristLimits = Partial<Record<'pro' | 'flex' | 'dev', [number, number]>>

export type ArmOptions = {
  /** direction the elbow points */
  pole: V3
  swivel?: number
  minFlex?: number
  /** wrist extension bias about the handle axis, deg (+ extends) */
  wristBias?: number
  planeHint?: number
  /** hand site that meets the grip point (default grip_<side>) */
  site?: string
  /** per-exercise forearm/wrist limits that replace the skeleton's (front rack wrist extension) */
  limits?: WristLimits
  /** scapular upward rotation: 'rhythm' (default) follows the solved arm elevation; a number fixes it */
  uprot?: 'rhythm' | number
  /** comfortable wrist deviation range, deg (default DEV_BAND) */
  devBand?: [number, number]
}

/**
 * Wrist deviation a grip settles into, deg (+ radial). Hands avoid the end of their range: when a handle would need
 * more, it lies obliquely across the palm instead (the power-grip crease is itself oblique).
 */
export const DEV_BAND: [number, number] = [-22, 12]

/** smooth saturation into [lo, hi]: identity in the middle, tanh over the last `w` degrees, so frames stay smooth */
export function softBand(x: number, [lo, hi]: [number, number], w = 5): number {
  if (x > hi - w) return hi - w + w * Math.tanh((x - (hi - w)) / w)
  if (x < lo + w) return lo + w + w * Math.tanh((x - (lo + w)) / w)
  return x
}

const DISTAL: V3 = [0, -1, 0]

export function jointByName(skel: Skeleton, name: string) {
  const j = skel.joints.find((x) => x.name === name)
  if (!j) throw new Error(`unknown joint ${name}`)
  return j
}

/** decompose the hand relative to the un-pronated forearm into pronation, wrist flexion and deviation (deg) */
function forearmWrist(skel: Skeleton, side: Side, rel: Quat): number[] {
  const pro = skel.dofs[skel.dof[`forearm_${side}.pro`]]
  const fl = skel.dofs[skel.dof[`wrist_${side}.flex`]]
  const dv = skel.dofs[skel.dof[`wrist_${side}.dev`]]
  const e = eulerFrom(rel, 1 as Axis, 2 as Axis, 0 as Axis)
  return [(e[0] * RAD) / pro.axis[1], (e[1] * RAD) / fl.axis[2], (e[2] * RAD) / dv.axis[0]]
}

function forearmWristRot(skel: Skeleton, side: Side, v: number[]): Quat {
  const pro = skel.dofs[skel.dof[`forearm_${side}.pro`]].axis
  const fl = skel.dofs[skel.dof[`wrist_${side}.flex`]].axis
  const dv = skel.dofs[skel.dof[`wrist_${side}.dev`]].axis
  return qmul(qmul(qaxis(pro, v[0] * DEG), qaxis(fl, v[1] * DEG)), qaxis(dv, v[2] * DEG))
}

/** elbow local rotation (flexion about the oblique hinge, carrying angle included) */
export function elbowRotation(skel: Skeleton, side: Side, flexDeg: number): Quat {
  const j = jointByName(skel, `elbow_${side}`)
  return hingeRotation(j, flexDeg, skel.dofs[j.dofs[0]].axis)
}

/**
 * Arm IK so the hand's grip site lands on `grip`. The hand's roll about the handle is searched (1-D) so wrist
 * flexion hits -wristBias with the palm facing `grip.palm`; if wrist deviation would pass its limit, the handle
 * is allowed to cross the palm obliquely instead. Clavicle and trunk DOFs must already be set; scapular upward
 * rotation follows the solved elevation (fixed point, it moves the shoulder joint) unless given.
 * Returns the remaining grip error in metres (non-zero only when forearm or wrist limits bind).
 */
export function attachHand(skel: Skeleton, q: Float64Array, side: Side, grip: GripTarget, o: ArmOptions): number {
  const d = skel.dof
  const up = d[`scapula_${side}.uprot`]
  const mode = o.uprot ?? 'rhythm'
  if (typeof mode === 'number') q[up] = mode
  else {
    // start from the elevation of the shoulder-to-grip line (exact for a straight arm)
    const f = fk(skel, q)
    const toGrip = norm(sub(grip.pos, f.pos[skel.seg[`humerus_${side}`]]))
    const down = qrot(f.rot[skel.seg.thorax2], [0, -1, 0])
    q[up] = shoulderRhythm(Math.acos(clamp(dot(toGrip, down), -1, 1)) * RAD, o.planeHint ?? 0).uprot
  }
  let r = solveArm(skel, q, side, grip, o)
  if (mode === 'rhythm') {
    for (let it = 0; it < 8; it++) {
      const next = shoulderRhythm(q[d[`shoulder_${side}.elev`]], q[d[`shoulder_${side}.plane`]]).uprot
      if (Math.abs(next - q[up]) < 1e-3) break
      q[up] = next
      r = solveArm(skel, q, side, grip, o, r.hint)
    }
  }
  return r.err
}

type RollHint = { across: V3; dir: V3; swivel?: number }

function solveArm(skel: Skeleton, q: Float64Array, side: Side, grip: GripTarget, o: ArmOptions, hint?: RollHint): { err: number; hint?: RollHint } {
  const f0 = fk(skel, q)
  const thorax = f0.rot[skel.seg.thorax2]
  const gh = f0.pos[skel.seg[`humerus_${side}`]]
  const lu = skel.segments[skel.seg[`humerus_${side}`]].length
  const lf = skel.segments[skel.seg[`forearm_${side}`]].length
  const site = skel.data.sites[o.site ?? `grip_${side}`]
  const palmL = site.normal!
  const acrossL = grip.oblique ? qrot(qaxis(palmL, (side === 'l' ? 1 : -1) * grip.oblique * DEG), site.axis!) : site.axis!
  const names = [`forearm_${side}.pro`, `wrist_${side}.flex`, `wrist_${side}.dev`]
  const keys = ['pro', 'flex', 'dev'] as const
  const lims = names.map((n, i) => {
    const dof = skel.dofs[skel.dof[n]]
    const [min, max] = o.limits?.[keys[i]] ?? [dof.min, dof.max]
    return { min, max, axis: dof.axis }
  })
  const devAxis = lims[2].axis
  // comfortable wrist deviation: past it the handle crosses the palm obliquely instead of the wrist bending further
  const band: [number, number] = [Math.max(lims[2].min, o.devBand?.[0] ?? DEV_BAND[0]), Math.min(lims[2].max, o.devBand?.[1] ?? DEV_BAND[1])]
  const excess = (fw: number[]) => fw.reduce((a, v, i) => a + Math.max(0, v - lims[i].max, lims[i].min - v), 0)
  const hinge = (flex: number) => elbowRotation(skel, side, flex)
  const carry = jointByName(skel, `elbow_${side}`).carry ?? 0

  const solveTo = (hand: Quat, swivel: number) => {
    const wrist = sub(grip.pos, qrot(hand, site.local))
    const ik = hingeIK(gh, wrist, lu, lf, hinge, o.pole, { minFlex: o.minFlex ?? 1, soft: 3, swivel, maxFlex: 170, carry })
    return { ik, hum: ik.upper, fore0: ik.lower, hand, swivel, fw: forearmWrist(skel, side, qmul(qconj(ik.lower), hand)) }
  }
  type Sol = ReturnType<typeof solveTo>
  const hintOf = (b: Sol): RollHint => ({ across: norm(qrot(b.hand, acrossL)), dir: qrot(b.hand, DISTAL) })

  /** best hand roll about the handle for a given bend-plane swivel */
  const pick = (swivel: number, h?: RollHint): Sol => {
    if (grip.hand) {
      // a fixed hand turns about the deviation axis (the handle slides obliquely across the palm) until the wrist
      // is back inside its comfortable range
      let r = solveTo(grip.hand, swivel)
      for (let it = 0; it < 6; it++) {
        const devC = softBand(r.fw[2], band)
        if (Math.abs(devC - r.fw[2]) < 0.05) break
        r = solveTo(qmul(r.hand, qaxis(devAxis, (devC - r.fw[2]) * DEG)), swivel)
      }
      return r
    }
    let seed = reject(sub(grip.pos, gh), grip.axis)
    if (len(seed) < 1e-6) seed = reject([0, 1, 0], grip.axis)
    const target = -(o.wristBias ?? 0)
    const score = (r: Sol) =>
      (dot(qrot(r.hand, palmL), grip.palm) < 0 ? 1e4 : 0) + excess(r.fw) * 10 + Math.abs(r.fw[2]) * 0.1 + Math.abs(r.fw[0]) * 0.01
    // roll of the hand about the handle: roots of wrist flexion = target within [lo, hi] around seedDir
    const search = (across: V3, seedDir: V3, lo: number, hi: number, n: number) => {
      const e1 = norm(reject(seedDir, across))
      const e2 = norm(cross(across, e1))
      const handAt = (th: number) => qalign(acrossL, DISTAL, across, add(scale(e1, Math.cos(th)), scale(e2, Math.sin(th))))
      const g = (th: number) => solveTo(handAt(th), swivel).fw[1] - target
      const cands: number[] = []
      let pth = lo, pg = g(pth), bestTh = pth, bestAbs = Math.abs(pg)
      for (let k = 1; k <= n; k++) {
        const th = lo + ((hi - lo) * k) / n
        const gv = g(th)
        if (Math.abs(gv) < bestAbs) [bestTh, bestAbs] = [th, Math.abs(gv)]
        // skip wrap-around jumps of the angle decomposition
        if (Math.sign(gv) !== Math.sign(pg) && Math.abs(gv - pg) < 120) cands.push(root1d(g, pth, th, { tol: 1e-5, scan: 1 }).x)
        pth = th
        pg = gv
      }
      if (!cands.length) cands.push(bestTh)
      return cands.map((th) => solveTo(handAt(th), swivel)).reduce((a, b) => (score(b) < score(a) ? b : a))
    }
    let best: Sol
    if (h) best = search(h.across, h.dir, -0.3, 0.3, 3)
    else {
      // the index finger may point either way along the handle: search both
      const axis = norm(grip.axis)
      const a = search(axis, seed, -Math.PI, Math.PI, 24)
      const b = search(scale(axis, -1), seed, -Math.PI, Math.PI, 24)
      best = score(b) < score(a) ? b : a
    }
    const dev = best.fw[2]
    const devC = softBand(dev, band)
    if (Math.abs(dev - devC) > 1e-6) {
      // let the handle cross the palm obliquely (tilt about the wrist deviation axis) just enough that deviation
      // sits on its limit; 1-D root find on the tilt keeps this continuous from frame to frame
      const hand0 = best.hand
      const seedDir = qrot(hand0, DISTAL)
      const tilt = (k: number) => search(norm(qrot(qmul(hand0, qaxis(devAxis, k * (devC - dev) * DEG)), acrossL)), seedDir, -0.5, 0.5, 4)
      const r = root1d((k) => tilt(k).fw[2] - devC, 0, 3, { tol: 1e-4, scan: 6 })
      best = tilt(r.x)
    }
    return best
  }

  let best = pick(hint?.swivel ?? o.swivel ?? 0, hint)
  const proOver = (b: Sol) => Math.max(0, b.fw[0] - lims[0].max) - Math.max(0, lims[0].min - b.fw[0])
  if (!grip.hand && proOver(best) !== 0) {
    // the forearm has run out of rotation: turn the bend plane about the shoulder-wrist line (humeral rotation)
    // until pronation is back just inside its limit, trying the smaller turn first
    const goal = proOver(best) > 0 ? lims[0].max - 0.5 : lims[0].min + 0.5
    const h0 = hintOf(best)
    const sw0 = best.swivel
    const g = (x: number) => pick(sw0 + x, h0).fw[0] - goal
    const g0 = g(0)
    const dir = Math.abs(g(3)) < Math.abs(g0) ? 1 : -1
    let found: number | undefined
    let ga = g0
    for (let step = 5; step <= 90 && found === undefined; step += 5) {
      const a = dir * (step - 5), b = dir * step
      const gb = g(b)
      if (Math.sign(ga) !== Math.sign(gb) && Math.abs(gb - ga) < 60) found = root1d(g, Math.min(a, b), Math.max(a, b), { tol: 1e-4, scan: 1 }).x
      ga = gb
    }
    if (found !== undefined) best = pick(sw0 + found, h0)
  }
  const across = grip.hand ? undefined : hintOf(best).across
  let s = best!
  let fw = s.fw
  const clamped = fw.map((v, i) => clamp(v, lims[i].min, lims[i].max))
  if (clamped.some((v, i) => Math.abs(v - fw[i]) > 1e-9)) {
    // re-aim with the hand orientation the forearm and wrist can actually reach
    for (let it = 0; it < 8; it++) s = solveTo(qmul(s.fore0, forearmWristRot(skel, side, clamped)), s.swivel)
    fw = clamped
  }
  const sh = shoulderAngles(qmul(qconj(thorax), s.hum), side, o.planeHint ?? 0)
  const d = skel.dof
  q[d[`shoulder_${side}.plane`]] = sh.plane
  q[d[`shoulder_${side}.elev`]] = sh.elev
  q[d[`shoulder_${side}.rot`]] = sh.rot
  q[d[`elbow_${side}.flex`]] = s.ik.flex
  q[d[`forearm_${side}.pro`]] = fw[0]
  q[d[`wrist_${side}.flex`]] = fw[1]
  q[d[`wrist_${side}.dev`]] = fw[2]
  const f1 = fk(skel, q)
  const hs = skel.seg[`hand_${side}`]
  const err = dist(add(f1.pos[hs], qrot(f1.rot[hs], site.local)), grip.pos)
  return { err, hint: across ? { across, dir: qrot(best.hand, DISTAL), swivel: best.swivel } : undefined }
}

/** hand world orientation for a site frame: handle axis and palm direction (for implements that follow the hand) */
export function handFrame(skel: Skeleton, f: FK, side: Side): { pos: V3; rot: Quat; axis: V3; palm: V3 } {
  const s = skel.data.sites[`grip_${side}`]
  const i = skel.seg[`hand_${side}`]
  const rot = f.rot[i]
  const axis = qrot(rot, s.axis!)
  const palm = qrot(rot, s.normal!)
  return { pos: add(f.pos[i], qrot(rot, s.local)), rot, axis, palm }
}

/** implement rotation whose local X follows the hand's handle axis and local Y the palm normal */
export function implementFromHand(axis: V3, palm: V3): Quat {
  return qalign([1, 0, 0], [0, 1, 0], axis, norm(cross(cross(axis, palm), axis)))
}

export function midpoint(a: V3, b: V3): V3 {
  return scale(add(a, b), 0.5)
}


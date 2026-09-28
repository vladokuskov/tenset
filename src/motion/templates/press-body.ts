import { attachHand, DEV_BAND, plantFoot, root1d, softBand, solveLegs, type FootTarget, type GripTarget } from '../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts, type Capsule, type Solid } from '../collide.ts'
import { fk, segPos, type FK } from '../fk.ts'
import type { ImplementSpec } from '../implements.ts'
import { dls } from '../ik.ts'
import { add, DEG, qconj, qrot, RAD, sub, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Skeleton } from '../skeleton.ts'
import { setPelvis } from './standing.ts'

// Shared by the supported presses (bench, incline, seated machine): the body resting on a seat and a back pad, the
// head against the pad, planted feet, and the arms solved to the grips with the elbow flare set at the bottom.

export type Posture = { tilt: number; lumbar: number; thorax: number; clavicle: { prot: number; elev: number } }

export function trunkPose(skel: Skeleton, q: Float64Array, hip: V3, s: Posture) {
  setDofs(skel, q, { 'lumbar.flex': s.lumbar, 'thorax.flex': s.thorax, 'clavicle_*.prot': s.clavicle.prot, 'clavicle_*.elev': s.clavicle.elev, 'grip_*.close': 1 })
  setPelvis(skel, q, hip, s.tilt)
}

/** one part of an implement as a world-space solid */
export function solidOf(spec: ImplementSpec, pose: ImplementPose, i: number): Solid {
  return placeParts({ ...spec, parts: [spec.parts[i]] }, pose)[0]
}

export const minClear = (caps: Capsule[], solid: Pick<Solid, 'sd'>) => Math.min(...caps.map((c) => capsuleSolidClearance(c, solid)))

/** what sits on the seat: the pelvis and the thigh roots (the thighs held level while placing) */
export const SEAT_CAPS = (c: Capsule) => c.segment === 'pelvis' || /^thigh_[lr]1$/.test(c.name)
/** what rests on the back pad: the upper back */
export const BACK_CAPS = (c: Capsule) => c.segment === 'thorax1' || c.segment === 'thorax2'

/** trunk and thigh capsules for a posture placed at `hip`, thighs level */
export function seatedCaps(skel: Skeleton, hip: V3, s: Posture): Capsule[] {
  const q = zeroQ(skel)
  trunkPose(skel, q, hip, s)
  setDofs(skel, q, { 'hip_*.flex': 90 + s.tilt })
  return bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'trunk' || c.region.startsWith('thigh_'))
}

/** hip midpoint (x = 0) that seats the pelvis on `seat` and rests the upper back on `back`, both sunk `sink` m */
export function seatOnPads(skel: Skeleton, s: Posture, seat: Solid, back: Solid, guess: [number, number], sink: number): V3 {
  const res = (x: number[]) => {
    const c = seatedCaps(skel, [0, x[0], x[1]], s)
    return [(minClear(c.filter(SEAT_CAPS), seat) + sink) * 100, (minClear(c.filter(BACK_CAPS), back) + sink) * 100]
  }
  const r = dls(res, guess, { tol: 1e-7, iters: 60 })
  return [0, r.x[0], r.x[1]]
}

/** neck flexion (head following at 0.4) that rests the back of the head on the pad with a light contact */
export function restHead(skel: Skeleton, q: Float64Array, back: Solid, sink = 0.004) {
  const clear = (flex: number) => {
    setDofs(skel, q, { 'neck.flex': flex, 'head.flex': flex * 0.4 })
    return minClear(bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'head'), back) + sink
  }
  const r = root1d(clear, -30, 25, { tol: 1e-5 })
  clear(r.bracketed ? r.x : 0)
}

/** feet flat on the floor `half` m either side of the midline, as far forward as gives this knee flexion */
export function plantFeet(skel: Skeleton, q: Float64Array, hip: V3, knee: number, half: number, toe = 18): { feet: FootTarget[]; contacts: Contact[] } {
  const at = (z: number) => [plantFoot(skel, 'l', [half, 0, z], toe), plantFoot(skel, 'r', [-half, 0, z], toe)]
  const z = root1d((zz) => {
    solveLegs(skel, q, at(zz))
    return q[skel.dof['knee_l.flex']] - knee
  }, hip[2] + 0.15, hip[2] + 0.9, { tol: 1e-6 }).x
  const feet = at(z)
  solveLegs(skel, q, feet)
  const contacts: Contact[] = []
  for (const ft of feet) for (const site of ['heel', 'ball']) {
    const name = `${site}_${ft.side}`
    contacts.push({ site: name, kind: 'planted', target: { world: add(ft.ankle, qrot(ft.rot, skel.data.sites[name].local)) } })
  }
  return { feet, contacts }
}

const ARM = ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']

/** bilateral work: the left arm is solved and mirrored, so both sides match exactly */
export function mirrorArm(skel: Skeleton, q: Float64Array) {
  for (const k of ARM) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

export type ArmRig = {
  pole: V3
  palm: V3
  wristBias: number
  /** how obliquely the handle crosses the palm over the rep (contraction c), deg; see wristSchedule */
  oblique?: (c: number) => number
}

/** the wrist's full deviation range: with a scheduled obliquity the hand solver's own saturation stays out of the way */
const JOINT_DEV: [number, number] = [-35, 20]
const RELAXED: { devBand: [number, number]; limits: { dev: [number, number] } } = { devBand: [-89, 89], limits: { dev: [-90, 90] } }

/** `relaxed` lifts the deviation limits, to measure the deviation a grip would need (wristSchedule) */
export function solveLeftArm(skel: Skeleton, q: Float64Array, grip: Omit<GripTarget, 'palm'>, rig: ArmRig, c = 0, relaxed = false): number {
  const oblique = rig.oblique?.(c) ?? 0
  const band = relaxed ? RELAXED : rig.oblique ? { devBand: JOINT_DEV } : {}
  const err = attachHand(skel, q, 'l', { ...grip, palm: rig.palm, ...(oblique ? { oblique } : {}) }, { pole: rig.pole, wristBias: rig.wristBias, planeHint: 60, ...band })
  mirrorArm(skel, q)
  return err
}

/** natural cubic spline through (xs, ys), xs ascending: C2, so the scheduled channel has no acceleration steps */
function naturalCubic(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length
  const h = xs.slice(1).map((x, i) => x - xs[i])
  // tridiagonal solve for the second derivatives (zero at both ends)
  const m = new Array<number>(n).fill(0)
  const c = new Array<number>(n).fill(0)
  const d = new Array<number>(n).fill(0)
  for (let i = 1; i < n - 1; i++) {
    const a = h[i - 1], b = 2 * (h[i - 1] + h[i])
    const r = 6 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1])
    const den = b - a * c[i - 1]
    c[i] = h[i] / den
    d[i] = (r - a * d[i - 1]) / den
  }
  for (let i = n - 2; i > 0; i--) m[i] = d[i] - c[i] * m[i + 1]
  return (x) => {
    let k = 0, hi = n - 1
    while (hi - k > 1) {
      const mid = (k + hi) >> 1
      if (xs[mid] <= x) k = mid
      else hi = mid
    }
    const t = x - xs[k], hk = h[k]
    const b = (ys[k + 1] - ys[k]) / hk - (hk * (2 * m[k] + m[k + 1])) / 6
    return ys[k] + b * t + (m[k] / 2) * t * t + ((m[k + 1] - m[k]) / (6 * hk)) * t * t * t
  }
}

/**
 * The forearm's angle to the handle changes through a press, so the wrist would deviate by ~30 deg over the rep
 * (most of it in the last few degrees of elbow extension). Past the comfortable band (DEV_BAND, soft edges) the
 * handle crosses the palm obliquely instead. The hand solver decides that frame by frame, which kinks the deviation
 * channel; here the obliquity is solved at knots (dense at both ends of the rep) and splined over contraction.
 * `devAt(c, oblique)` poses the arm at c with the deviation limits relaxed and returns the left wrist deviation.
 */
export function wristSchedule(devAt: (c: number, oblique: number) => number, samples = 33): (c: number) => number {
  const cs = Array.from({ length: samples }, (_, k) => 0.5 - 0.5 * Math.cos((Math.PI * k) / (samples - 1)))
  const obl = cs.map((c) => {
    const nat = devAt(c, 0)
    const want = softBand(nat, DEV_BAND)
    // secant on the obliquity (it takes roughly its own angle out of the deviation)
    let [o0, e0] = [0, nat - want]
    if (Math.abs(e0) < 0.02) return 0
    let o1 = e0
    for (let it = 0; it < 8; it++) {
      const e1 = devAt(c, o1) - want
      if (Math.abs(e1) < 0.02) break
      const o2 = o1 - (e1 * (o1 - o0)) / (e1 - e0)
      ;[o0, e0, o1] = [o1, e1, o2]
    }
    return o1
  })
  return naturalCubic(cs, obl)
}

/** upper-arm abduction from the torso in its frontal plane, deg */
export function flareOf(skel: Skeleton, f: FK, side: 'l' | 'r' = 'l'): number {
  const h = sub(segPos(skel, f, `forearm_${side}`), segPos(skel, f, `humerus_${side}`))
  const l = qrot(qconj(f.rot[skel.seg.thorax2]), h)
  return Math.atan2(Math.abs(l[0]), -l[1]) * RAD
}

/** left elbow pole: `down` part towards the floor, leaning from the feet (0) out to the side (90) by `th` deg */
export const poleAt = (th: number, down = 0.6, back = 1): V3 => [Math.sin(th * DEG), -down, Math.cos(th * DEG) * back]

/**
 * pole lean that puts the upper arm at `flare` in the arm pose `solve(pole)` returns (flare grows monotonically with
 * the lean between `range`)
 */
export function flarePole(skel: Skeleton, flare: number, solve: (pole: V3) => Float64Array, pole: (th: number) => V3 = (th) => poleAt(th), range: [number, number] = [15, 140]): V3 {
  const th = root1d((t) => flareOf(skel, fk(skel, solve(pole(t)))) - flare, range[0], range[1], { tol: 1e-4 }).x
  return pole(th)
}

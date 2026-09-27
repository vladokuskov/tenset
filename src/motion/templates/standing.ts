import { legKinematics, plantFoot, root1d, solveLegs, type FootTarget } from '../constraints.ts'
import { dls } from '../ik.ts'
import { add, DEG, qaxis, qrot, scale, sub, type V3 } from '../math.ts'
import { jointRotation, type Contact, type Skeleton } from '../skeleton.ts'

// Shared lower-body solver for standing templates: planted feet, hips placed so the legs hit keyed knee flexion
// and ankle dorsiflexion, pelvis tilt for the trunk.

export type StanceName = 'narrow' | 'hip' | 'shoulder' | 'wide'
export type StanceSetup = { feet: FootTarget[]; midfoot: V3 }

export function stanceWidth(skel: Skeleton, stance: StanceName): number {
  const { hipWidth, shoulderWidth } = skel.data
  switch (stance) {
    case 'narrow': return 0.8 * hipWidth
    case 'hip': return hipWidth + 0.03
    case 'shoulder': return shoulderWidth
    case 'wide': return 1.4 * shoulderWidth
  }
}

/** feet symmetric about x = 0 with midfoot sites on the line z */
export function makeStance(skel: Skeleton, width: number, toeOut: number, z = 0): StanceSetup {
  return { feet: [plantFoot(skel, 'l', [width / 2, 0, z], toeOut), plantFoot(skel, 'r', [-width / 2, 0, z], toeOut)], midfoot: [0, 0, z] }
}

/** planted heel and ball contacts with their world targets from the foot placement */
export function plantedContacts(skel: Skeleton, stance: StanceSetup): Contact[] {
  const out: Contact[] = []
  for (const f of stance.feet) {
    for (const site of ['heel', 'ball']) {
      const name = `${site}_${f.side}`
      out.push({ site: name, kind: 'planted', target: { world: add(f.ankle, qrot(f.rot, skel.data.sites[name].local)) } })
    }
  }
  return out
}

export function hipMidLocal(skel: Skeleton): V3 {
  const l = skel.segments[skel.seg.femur_l].offset
  const r = skel.segments[skel.seg.femur_r].offset
  return scale(add(l, r), 0.5)
}

/** place the pelvis by its hip midpoint and orientation (deg) */
export function setPelvis(skel: Skeleton, q: Float64Array, hipMid: V3, tilt: number, yaw = 0, list = 0) {
  const d = skel.dof
  q[d['pelvis.tilt']] = tilt
  q[d['pelvis.rot']] = yaw
  q[d['pelvis.list']] = list
  const rot = jointRotation(skel, skel.joints[0], q)
  const o = sub(hipMid, qrot(rot, hipMidLocal(skel)))
  q[d['pelvis.tx']] = o[0]
  q[d['pelvis.ty']] = o[1]
  q[d['pelvis.tz']] = o[2]
}

/** hip midpoint (x = 0) whose legs reach the planted feet with the given knee flexion and ankle dorsiflexion */
export function hipsFor(skel: Skeleton, stance: StanceSetup, knee: number, df: number, tilt = 0): V3 {
  const lt = skel.segments[skel.seg.femur_l].length
  const ls = skel.segments[skel.seg.tibia_l].length
  const foot = stance.feet[0]
  const pelvisRot = qaxis([1, 0, 0], tilt * DEG)
  const off = qrot(pelvisRot, sub(skel.segments[skel.seg.femur_l].offset, hipMidLocal(skel)))
  const a = df * DEG
  const k = knee * DEG
  const kneeGuess = add(foot.ankle, [0, ls * Math.cos(a), ls * Math.sin(a)])
  const planar = add(kneeGuess, [0, lt * Math.cos(k - a), -lt * Math.sin(k - a)])
  // the planar guess ignores stance width; fix the height so the hip-ankle distance matches the knee angle
  const reach = Math.sqrt(lt * lt + ls * ls + 2 * lt * ls * Math.cos(k))
  const dx = off[0] - foot.ankle[0]
  const dz = planar[2] - foot.ankle[2]
  const hipGuess: V3 = [off[0], foot.ankle[1] + Math.sqrt(Math.max(0.01, reach * reach - dx * dx - dz * dz)), planar[2]]
  const res = (x: number[]) => {
    const leg = legKinematics(skel, 'l', add([0, x[0], x[1]], off), pelvisRot, foot)
    return [(leg.knee - knee) * DEG, (leg.ankle[0] - df) * DEG]
  }
  const s = dls(res, [hipGuess[1] - off[1], hipGuess[2] - off[2]], { tol: 1e-10, iters: 40 })
  return [0, s.x[0], s.x[1]]
}

export type StandTargets = { knee: number; df: number; tilt: number }

/** set pelvis and both legs for keyed knee flexion, ankle dorsiflexion and pelvis tilt */
export function stand(skel: Skeleton, q: Float64Array, stance: StanceSetup, t: StandTargets) {
  setPelvis(skel, q, hipsFor(skel, stance, t.knee, t.df, t.tilt), t.tilt)
  solveLegs(skel, q, stance.feet)
}

/** ankle lean held near `ref`; only `follow` of each balancing correction is applied */
export type Sway = { ref: number; follow: number }

/**
 * Stand with the ankle dorsiflexion chosen by a 1-D root find so `measure` (e.g. system COM forward coordinate)
 * sits over the midfoot. `upper` sets whatever else depends on the lower body (arms by IK, etc.).
 * Returns the dorsiflexion used (x) and the remaining forward offset of `measure` from the midfoot.
 */
export function standBalanced(
  skel: Skeleton,
  q: Float64Array,
  stance: StanceSetup,
  t: { knee: number; tilt: number },
  measure: (q: Float64Array) => number,
  upper?: (q: Float64Array) => void,
  dfRange: [number, number] = [-12, 25],
  sway?: Sway,
) {
  const r = root1d((df) => {
    stand(skel, q, stance, { knee: t.knee, df, tilt: t.tilt })
    upper?.(q)
    return measure(q) - stance.midfoot[2]
  }, dfRange[0], dfRange[1], { tol: 1e-7 })
  const df = sway ? sway.ref + sway.follow * (r.x - sway.ref) : r.x
  stand(skel, q, stance, { knee: t.knee, df, tilt: t.tilt })
  upper?.(q)
  return { x: df, offset: measure(q) - stance.midfoot[2], bracketed: r.bracketed }
}

/**
 * Balance tolerance for standing arm work, m. The bar-over-midfoot 2.5 cm band is for loaded squats and hinges;
 * here the COM only has to stay well inside the base of support (ball of the foot 5.7 cm ahead of the midfoot).
 */
export const ARM_BALANCE_TOL = 0.035

/**
 * Arm work while standing: a loaded arm moving forward shifts the COM several cm, which a real lifter absorbs by
 * moving the centre of pressure inside the foot, not by rocking at the ankles. Holds the ankle halfway between the
 * balanced angles at the ends of the rep and follows only as much as keeps the COM within `keep` m of the midfoot.
 */
export function limitSway(balance: (u: number, sway?: Sway) => { x: number; offset: number }, keep = ARM_BALANCE_TOL - 0.005, n = 16): Sway {
  const us = Array.from({ length: n }, (_, i) => i / n)
  const dfs = us.map((u) => balance(u).x)
  const ref = (Math.min(...dfs) + Math.max(...dfs)) / 2
  const h = Math.max(...us.map((u) => Math.abs(balance(u, { ref, follow: 0 }).offset)))
  return { ref, follow: h > keep ? 1 - keep / h : 0 }
}

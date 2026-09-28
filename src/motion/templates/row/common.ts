import { attachHand, type ArmOptions, type GripTarget } from '../../constraints.ts'
import { fk, segPos } from '../../fk.ts'
import { add, DEG, norm, qrot, scale, type V3 } from '../../math.ts'
import type { Contact, Skeleton } from '../../skeleton.ts'
import type { ParamsOf } from '../schemas.ts'
import { phaseAt, type Tempo } from '../../timing.ts'

// Shared pieces of the row variants. Every row reads as scapular retraction first, then the elbow drive: the
// clavicles lead (most of the retraction happens in the first third of the concentric and is released last on the
// way down) and the hands follow a lagging curve. The spine stays neutral; any trunk travel is small and moves with
// the scapulae, never late (no yank).

export type P = ParamsOf<'row'>
export type Side = 'l' | 'r'

/** clavicle protraction, deg: shoulders reach forward at the stretch, set back at the finish (limits -25..25) */
export const PROT = { start: 12, finish: -18 }

/** scapular share of the pull: leads the elbows on the way in, releases last on the way out */
export const scapularLead = (c: number) => 1 - (1 - c) ** 2.2
/** elbow drive progress: lags the scapulae */
export const ELBOW_LAG = 1.35
export const elbowDrive = (c: number) => c ** ELBOW_LAG

/**
 * grip-path progress for variants that move the hand along a line from the hang: near a straight elbow a little hand
 * travel is a lot of elbow bend, so the path lags further for the elbow to still trail the scapulae
 */
export const GRIP_LAG = 2
export const gripPath = (c: number) => c ** GRIP_LAG

export type Phases = { c: number; s: number; e: number; g: number }

export function phases(u: number, tempo: Tempo): Phases {
  const c = phaseAt(u, tempo).c
  return { c, s: scapularLead(c), e: elbowDrive(c), g: gripPath(c) }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const ARM_DOFS = ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']

/** bilateral holds solve the left arm and mirror it, so both sides match exactly */
export function mirrorArm(skel: Skeleton, q: Float64Array) {
  for (const k of ARM_DOFS) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

/**
 * Elbow direction for the IK, from the thorax frame: out by the flare angle, back (dorsal) and a little towards the
 * hips. `flare` is the upper-arm abduction from the torso the finish should show.
 */
export function elbowPole(skel: Skeleton, q: Float64Array, side: Side, flare: number, down = 0.25): V3 {
  const f = fk(skel, q)
  const lat = side === 'l' ? 1 : -1
  const a = flare * DEG
  const local = norm([lat * Math.sin(a), -down * Math.cos(a), -Math.cos(a)])
  return qrot(f.rot[skel.seg.thorax2], local)
}

export function reach(skel: Skeleton, q: Float64Array, side: Side, grip: GripTarget, o: ArmOptions) {
  return attachHand(skel, q, side, grip, o)
}

export function shoulderMid(skel: Skeleton, q: Float64Array): V3 {
  const f = fk(skel, q)
  return scale(add(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r')), 0.5)
}

export function gripContacts(implement: string, sites: [string, string] = ['l', 'r']): Contact[] {
  return [
    { site: 'grip_l', kind: 'grip', target: { implement, grip: sites[0] } },
    { site: 'grip_r', kind: 'grip', target: { implement, grip: sites[1] } },
  ]
}

export function working(p: P): Side {
  return p.side === 'left' ? 'l' : 'r'
}

export const other = (s: Side): Side => (s === 'l' ? 'r' : 'l')

/** piecewise-cubic Hermite through (xs, ys) with Fritsch-Carlson tangents: smooth and without overshoot */
export function monotoneCubic(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length
  const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]))
  const m = xs.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i])))
  return (x) => {
    let k = 0
    while (k < n - 2 && x > xs[k + 1]) k++
    const h = xs[k + 1] - xs[k], t = Math.min(1, Math.max(0, (x - xs[k]) / h))
    const t2 = t * t, t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1]
  }
}

import type { Capsule } from '../../collide.ts'
import type { FootTarget } from '../../constraints.ts'
import type { Part } from '../../implements.ts'
import { add, clamp, DEG, norm, qalign, qaxis, qfromBasis, qrot, RAD, reject, type Quat, type V3 } from '../../math.ts'
import { shoulderAngles } from '../../ik.ts'
import { setDofs, setScapula, type Contact, type ImplementPose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import type { Setup } from '../types.ts'

export type P = ParamsOf<'triceps-extension'>

/** what every variant context carries for the template's sample() and setup() */
export type Base = { tempo: Tempo; setup: Setup }

export type Sampled = { q: Float64Array; implements: ImplementPose[] }

export const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

/** rotation whose local Y is exactly `y`, local X as near `x` as possible */
export function frameY(y: V3, x: V3 = [1, 0, 0]): Quat {
  return qfromBasis(norm(reject(x, y)), y)
}

/** shoulder plane and elevation for a humerus direction in the thorax frame (left side; the right mirrors) */
export function swing(d: V3) {
  const elev = Math.acos(clamp(-d[1], -1, 1)) * RAD
  return { plane: elev < 2 ? 90 : Math.atan2(d[2], d[0]) * RAD, elev }
}

/** humerus direction in the thorax frame: flexion `flex` in the sagittal plane, then `abd` out to the side (left) */
export function armDir(flex: number, abd: number): V3 {
  const a = flex * DEG, s = abd * DEG
  return [Math.sin(s), -Math.cos(a) * Math.cos(s), Math.sin(a) * Math.cos(s)]
}

export function setArm(skel: Skeleton, q: Float64Array, v: { flex: number; abd: number; rot: number; elbow: number; pro: number; wrist: number; dev?: number }) {
  const { plane, elev } = swing(armDir(v.flex, v.abd))
  setDofs(skel, q, {
    'shoulder_*.plane': plane,
    'shoulder_*.elev': elev,
    'shoulder_*.rot': v.rot,
    'elbow_*.flex': v.elbow,
    'forearm_*.pro': v.pro,
    'wrist_*.flex': v.wrist,
    'wrist_*.dev': v.dev ?? 0,
    'grip_*.close': 1,
  })
  setScapula(skel, q, 'l')
  setScapula(skel, q, 'r')
}

export const ARM_DOFS = ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']

/** bilateral holds solve the left arm and mirror it */
export function mirrorArm(skel: Skeleton, q: Float64Array) {
  for (const k of ARM_DOFS) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

/** heel and ball contacts of planted feet */
export function footContacts(skel: Skeleton, feet: FootTarget[]): Contact[] {
  const out: Contact[] = []
  for (const ft of feet) for (const site of ['heel', 'ball']) {
    const name = `${site}_${ft.side}`
    out.push({ site: name, kind: 'planted', target: { world: add(ft.ankle, qrot(ft.rot, skel.data.sites[name].local)) } })
  }
  return out
}

/** lowest point of the capsules in these regions, m */
export const lowest = (caps: Capsule[], regions: string[]) =>
  Math.min(...caps.filter((c) => regions.includes(c.region)).map((c) => Math.min(c.a[1], c.b[1]) - c.r))

/**
 * Overhead humerus in the thorax frame (left): distal axis on `u`, the elbow bending towards straight back turned
 * `roll` deg about u (+ inwards). Built as a rotation since the plane / elevation chart is degenerate near 180 deg.
 */
export function overheadHumerus(u: V3, roll: number): Quat {
  const back = norm(reject([0, 0, -1], u))
  return qalign([0, -1, 0], [0, 0, 1], u, qrot(qaxis(u, roll * DEG), back))
}

/** left shoulder DOFs for an overhead humerus; near the pole the twist runs past 180, kept continuous instead of wrapping */
export function setOverheadShoulder(skel: Skeleton, q: Float64Array, u: V3, roll: number) {
  const sh = shoulderAngles(overheadHumerus(u, roll), 'l', 90)
  setDofs(skel, q, { 'shoulder_l.plane': sh.plane, 'shoulder_l.elev': sh.elev, 'shoulder_l.rot': sh.rot < -90 ? sh.rot + 360 : sh.rot })
  setScapula(skel, q, 'l')
}

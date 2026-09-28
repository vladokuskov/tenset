import { handFrame, plantFoot, root1d, softBand, solveLegs, type FootTarget } from '../constraints.ts'
import { centerOfPressure, fk, segPos, type PointForce, type PointMass } from '../fk.ts'
import { cableForce, type Cable, type ImplementSpec } from '../implements.ts'
import { add, cross, dot, norm, qfromBasis, qrot, reject, sub, type V3 } from '../math.ts'
import { shoulderRhythm, type Contact, type ImplementPose, type Skeleton } from '../skeleton.ts'
import { setPelvis, type StanceSetup } from './standing.ts'

// F3 chest-shoulder-isolation helpers (fly, front-raise, rear-raise, external-rotation): joint-space arms whose
// humeral and forearm rotation follow where the elbow should bend and the palm should face, split stance, cable
// handles that follow the hand.

export type Side = 'l' | 'r'
export const SIDES = ['l', 'r'] as const
export const other = (s: Side): Side => (s === 'l' ? 'r' : 'l')
/** a world direction authored for the left arm, for the right arm (bodies are symmetric about x = 0) */
export const forSide = (v: V3, s: Side): V3 => (s === 'l' ? v : [-v[0], v[1], v[2]])

export type ArmTarget = {
  /** humerothoracic plane of elevation and elevation, deg */
  plane: number
  elev: number
  elbow: number
  /** world direction the forearm bends towards (the elbow points away from it) */
  bend: V3
  /** world direction the palm faces */
  palm: V3
  wrist?: number
  dev?: number
  /** added to the scapulohumeral rhythm, deg */
  girdle?: { elev?: number; prot?: number; uprot?: number }
  /** scales the rhythm's clavicle elevation (a raise without a shrug keeps less of it) */
  shrug?: number
  close?: number
}

const DOWN: V3 = [0, -1, 0]

function axisOf(skel: Skeleton, q: Float64Array, seg: string): V3 {
  return qrot(fk(skel, q).rot[skel.seg[seg]], DOWN)
}

/** forearm direction change from a straight elbow: the direction the elbow bends the forearm */
function bendOf(skel: Skeleton, q: Float64Array, s: Side): V3 {
  const i = skel.dof[`elbow_${s}.flex`]
  const e = q[i]
  const bent = axisOf(skel, q, `forearm_${s}`)
  q[i] = 0
  const straight = axisOf(skel, q, `forearm_${s}`)
  q[i] = e
  return sub(bent, straight)
}

function palmOf(skel: Skeleton, q: Float64Array, s: Side): V3 {
  return handFrame(skel, fk(skel, q), s).palm
}

/**
 * Twist of a DOF that turns `probe` rigidly about `axis`: the value (deg) that points it closest to `target`,
 * from the probe at 0 and at 90 deg (it sweeps a circle about the axis).
 */
function twistFor(skel: Skeleton, q: Float64Array, dof: string, axis: V3, target: V3, probe: () => V3): number {
  const i = skel.dof[dof]
  q[i] = 0
  const p0 = reject(probe(), axis)
  q[i] = 90
  const p90 = reject(probe(), axis)
  const t = reject(target, axis)
  return (Math.atan2(dot(t, p90), dot(t, p0)) * 180) / Math.PI
}

/** joint-space arm: humerus by plane/elevation, humeral rotation from the bend direction, forearm rotation from the palm */
export function poseArm(skel: Skeleton, q: Float64Array, s: Side, t: ArmTarget) {
  const d = skel.dof
  const g = shoulderRhythm(t.elev, t.plane)
  q[d[`clavicle_${s}.elev`]] = g.elev * (t.shrug ?? 1) + (t.girdle?.elev ?? 0)
  q[d[`clavicle_${s}.prot`]] = g.prot + (t.girdle?.prot ?? 0)
  q[d[`scapula_${s}.uprot`]] = g.uprot + (t.girdle?.uprot ?? 0)
  q[d[`shoulder_${s}.plane`]] = t.plane
  q[d[`shoulder_${s}.elev`]] = t.elev
  q[d[`elbow_${s}.flex`]] = t.elbow
  q[d[`wrist_${s}.flex`]] = t.wrist ?? 0
  q[d[`wrist_${s}.dev`]] = t.dev ?? 0
  q[d[`forearm_${s}.pro`]] = 0
  q[d[`grip_${s}.close`]] = t.close ?? 1
  const rot = skel.dofs[d[`shoulder_${s}.rot`]]
  q[rot.index] = 0
  const hum = axisOf(skel, q, `humerus_${s}`)
  q[rot.index] = softBand(twistFor(skel, q, rot.name, hum, t.bend, () => bendOf(skel, q, s)), [rot.min, rot.max], 6)
  const pro = skel.dofs[d[`forearm_${s}.pro`]]
  const fore = axisOf(skel, q, `forearm_${s}`)
  q[pro.index] = softBand(twistFor(skel, q, pro.name, fore, t.palm, () => palmOf(skel, q, s)), [pro.min, pro.max], 6)
}

/** copy the left arm's DOFs to the right (bilateral holds that mirror exactly) */
export function mirrorArm(skel: Skeleton, q: Float64Array) {
  for (const k of ARM_DOFS) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

const ARM_DOFS = [
  'clavicle_*.elev', 'clavicle_*.prot', 'scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex',
  'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev', 'grip_*.close',
]

/** a relaxed free arm hanging at the side */
export function relaxedArm(skel: Skeleton, q: Float64Array, s: Side) {
  const d = skel.dof
  q[d[`shoulder_${s}.plane`]] = 30
  q[d[`shoulder_${s}.elev`]] = 8
  q[d[`elbow_${s}.flex`]] = 12
  q[d[`grip_${s}.close`]] = 0.3
  q[d[`scapula_${s}.uprot`]] = shoulderRhythm(8, 30).uprot
}

// ---------- directions ----------

/** unit direction of a humerus at plane/elevation in a thorax frame given as world axes (left arm) */
export function armDir(plane: number, elev: number, frame: { right: V3; up: V3; fwd: V3 }): V3 {
  const p = (plane * Math.PI) / 180, e = (elev * Math.PI) / 180
  // left arm: +X (lateral) is -right
  const lat = [-frame.right[0], -frame.right[1], -frame.right[2]] as V3
  const v = add(add(scaleV(lat, Math.sin(e) * Math.cos(p)), scaleV(frame.fwd, Math.sin(e) * Math.sin(p))), scaleV(frame.up, -Math.cos(e)))
  return norm(v)
}

const scaleV = (v: V3, k: number): V3 => [v[0] * k, v[1] * k, v[2] * k]

/** thorax axes in the world (right = figure's right, up along the spine, fwd = chest) */
export function thoraxFrame(skel: Skeleton, q: Float64Array) {
  const r = fk(skel, q).rot[skel.seg.thorax2]
  return { right: qrot(r, [-1, 0, 0]), up: qrot(r, [0, 1, 0]), fwd: qrot(r, [0, 0, 1]) }
}

// ---------- cable handles ----------

/** a cable handle held in a hand: across the palm (pinky to index), carabiner towards the pulley */
export function handleInHand(skel: Skeleton, q: Float64Array, s: Side, pulley: V3, handle: ImplementSpec, id = handle.id): ImplementPose {
  const h = handFrame(skel, fk(skel, q), s)
  const toward = norm(sub(pulley, h.pos))
  const rot = qfromBasis(h.axis, norm(cross(cross(h.axis, toward), h.axis)))
  return { id, pos: sub(h.pos, qrot(rot, handle.sites.c.pos)), rot }
}

/** centre of pressure (forward coordinate) of body + point loads + cable pulls */
export function pressureZ(skel: Skeleton, q: Float64Array, loads: PointMass[], cables: { cable: Cable; pose: ImplementPose }[] = []): number {
  const forces: PointForce[] = cables.map(({ cable, pose }) => cableForce(cable, pose))
  return centerOfPressure(skel, fk(skel, q), loads, forces)[1]
}

// ---------- split stance ----------

export type SplitStance = StanceSetup & { front: Side; step: number }

/**
 * Staggered stance, feet flat: the front foot `step`/2 ahead of the midfoot line and the rear foot as far behind,
 * each at hip width.
 */
export function splitStance(skel: Skeleton, front: Side, step: number, z = 0): SplitStance {
  const half = (skel.data.hipWidth + 0.03) / 2
  const f = plantFoot(skel, front, [front === 'l' ? half : -half, 0, z + step / 2], 8)
  const r = plantFoot(skel, other(front), [front === 'l' ? -half : half, 0, z - step / 2], 14)
  const feet: FootTarget[] = front === 'l' ? [f, r] : [r, f]
  return { feet, midfoot: [0, 0, z], front, step }
}

/**
 * Pelvis over a split stance: height from the front knee flexion, forward position `z` (or, with `measure`, the one
 * that puts the measured point over the midfoot line, held towards `sway.ref` as limitSway does); pelvis tilt as
 * given; legs solved to the planted feet, then `upper` sets the rest. Returns the balancing z and the remaining offset.
 */
export function standSplit(
  skel: Skeleton,
  q: Float64Array,
  st: SplitStance,
  o: { frontKnee: number; tilt: number },
  upper?: (q: Float64Array) => void,
  measure?: (q: Float64Array) => number,
  sway?: { ref: number; follow: number },
) {
  const lt = skel.segments[skel.seg.femur_l].length, ls = skel.segments[skel.seg.tibia_l].length
  const knee = skel.dof[`knee_${st.front}.flex`]
  const place = (z: number) => {
    const y = root1d((yy) => {
      setPelvis(skel, q, [0, yy, z], o.tilt)
      solveLegs(skel, q, st.feet)
      return q[knee] - o.frontKnee
    }, 0.6, lt + ls + 0.2, { tol: 1e-7 }).x
    setPelvis(skel, q, [0, y, z], o.tilt)
    solveLegs(skel, q, st.feet)
    upper?.(q)
  }
  const mid = st.midfoot[2]
  let z = mid
  if (measure) {
    z = root1d((zz) => {
      place(zz)
      return measure(q) - mid
    }, mid - 0.25, mid + 0.25, { tol: 1e-7 }).x
  }
  const used = sway ? sway.ref + sway.follow * (z - sway.ref) : z
  place(used)
  return { x: z, offset: measure ? measure(q) - mid : 0 }
}

/** planted heel and ball contacts for feet placed on the floor */
export function footContacts(skel: Skeleton, feet: FootTarget[]): Contact[] {
  const out: Contact[] = []
  for (const f of feet) {
    for (const site of ['heel', 'ball']) {
      const name = `${site}_${f.side}`
      out.push({ site: name, kind: 'planted', target: { world: add(f.ankle, qrot(f.rot, skel.data.sites[name].local)) } })
    }
  }
  return out
}

/** shoulder joint centre (glenohumeral) */
export function shoulderAt(skel: Skeleton, q: Float64Array, s: Side): V3 {
  return segPos(skel, fk(skel, q), `humerus_${s}`)
}

/** plane of elevation and elevation (deg) of a world direction for the left arm in a thorax frame (inverse of armDir) */
export function planeElevOf(dir: V3, frame: { right: V3; up: V3; fwd: V3 }): { plane: number; elev: number } {
  const d = norm(dir)
  const lat = -dot(d, frame.right), fwd = dot(d, frame.fwd), down = -dot(d, frame.up)
  return { plane: (Math.atan2(fwd, lat) * 180) / Math.PI, elev: (Math.acos(Math.max(-1, Math.min(1, down))) * 180) / Math.PI }
}

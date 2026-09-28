import { jointByName, plantFoot, root1d, writeLeg, type FootTarget, type LegSolve } from '../../constraints.ts'
import { bodyCapsules, type Capsule } from '../../collide.ts'
import { fk, type FK } from '../../fk.ts'
import { eulerAngles, limbRotation, twoBone } from '../../ik.ts'
import { FLOOR_MAT } from '../../implements/shared.ts'
import { add, cross, DEG, dot, len, norm, qaxis, qconj, qfromBasis, qmul, qrot, scale, sub, type Quat, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type Side, type Skeleton } from '../../skeleton.ts'

// Floor work on the shared mat (implements/shared.ts floorMat): bodies resting on the mat top with a little sink,
// flat palms, planted feet. Shared by the F9 core templates.

export const MAT_TOP = FLOOR_MAT.thick
/** how far resting body parts sink into the mat, m (the pad tolerance is 15 mm) */
export const SINK = 0.008

export const ARM_DOFS = ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']

/** bilateral work: the left arm is solved and mirrored, so both sides match exactly */
export function mirrorArm(skel: Skeleton, q: Float64Array) {
  for (const k of ARM_DOFS) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

export const segPosOf = (skel: Skeleton, f: FK, seg: string) => f.pos[skel.seg[seg]]
export const toWorld = (skel: Skeleton, f: FK, seg: string, local: V3): V3 => add(f.pos[skel.seg[seg]], qrot(f.rot[skel.seg[seg]], local))
export const toLocal = (skel: Skeleton, f: FK, seg: string, world: V3): V3 => qrot(qconj(f.rot[skel.seg[seg]]), sub(world, f.pos[skel.seg[seg]]))

/** lowest point of the capsules above the mat top (negative = sunk in), m */
export function matClearance(caps: Capsule[]): number {
  return Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r - MAT_TOP))
}

/** lowers or raises the root so the picked capsules rest on the mat, sunk `sink` m */
export function restOnMat(skel: Skeleton, q: Float64Array, pick: (c: Capsule) => boolean, sink = SINK) {
  const ty = skel.dof['pelvis.ty']
  for (let k = 0; k < 4; k++) {
    const e = matClearance(bodyCapsules(skel, fk(skel, q)).filter(pick)) + sink
    q[ty] -= e
    if (Math.abs(e) < 1e-7) break
  }
}

/** neck flexion (the head following at `share`) that rests the back of the head on the mat with a light contact */
export function restHead(skel: Skeleton, q: Float64Array, share = 0.3, sink = 0.004) {
  const clear = (flex: number) => {
    setDofs(skel, q, { 'neck.flex': flex, 'head.flex': flex * share })
    return matClearance(bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'head')) + sink
  }
  const r = root1d(clear, -30, 50, { tol: 1e-6 })
  clear(r.x)
  return r.x
}

/** hand orientation with the palm down and the fingers pointing along the horizontal unit `dir` */
export function palmDown(side: Side, dir: V3): Quat {
  return qfromBasis(side === 'l' ? [0, 1, 0] : [0, -1, 0], [-dir[0], -dir[1], -dir[2]])
}

/** height of the grip site above the palm's surface when the hand lies flat, palm down, m */
export function palmHeight(skel: Skeleton): number {
  const f = fk(skel, zeroQ(skel))
  const grip = toWorld(skel, f, 'hand_l', skel.data.sites.grip_l.local)
  // zero pose: the left palm faces -X; its surface is the hand capsules' medial extreme
  const palm = Math.min(...bodyCapsules(skel, f).filter((c) => c.region === 'hand_l').map((c) => Math.min(c.a[0], c.b[0]) - c.r))
  return grip[0] - palm
}

/**
 * Leg IK to a foot target with the knee bending towards `pole` (world): constraints.ts legKinematics bends it over the
 * toes, which is degenerate when the leg lies along the foot (supine, kneeling).
 */
export function legToward(skel: Skeleton, q: Float64Array, foot: FootTarget, pole: V3): LegSolve {
  const f = fk(skel, q)
  const side = foot.side
  const hip = f.pos[skel.seg[`femur_${side}`]]
  const lt = skel.segments[skel.seg[`femur_${side}`]].length
  const ls = skel.segments[skel.seg[`tibia_${side}`]].length
  // knee hinge along the foot's lateral axis, so the ankle's two DOFs can reach the foot exactly
  const axis = norm(sub(foot.ankle, hip))
  let bend = cross(axis, qrot(foot.rot, [1, 0, 0]))
  if (dot(bend, pole) < 0) bend = scale(bend, -1)
  const ik = twoBone(hip, foot.ankle, lt, ls, len(bend) > 0.2 ? bend : pole, { minFlex: 0.5, soft: 2 })
  const knee: V3 = [1, 0, 0]
  const femur = limbRotation(hip, ik.mid, ik.hinge, knee)
  const tibia = qmul(femur, qaxis(knee, ik.flex * DEG))
  const h = eulerAngles(skel, jointByName(skel, `hip_${side}`), qmul(qconj(f.rot[skel.seg.pelvis]), femur))
  const a = eulerAngles(skel, jointByName(skel, `ankle_${side}`), qmul(qconj(tibia), foot.rot))
  const leg = { hip: h.values, knee: ik.flex, ankle: a.values, residual: a.residual, shortfall: ik.shortfall, femur, tibia, kneePos: ik.mid }
  writeLeg(skel, q, side, leg)
  return leg
}

/** both legs to their feet, knees towards `pole` */
export function legsToward(skel: Skeleton, q: Float64Array, feet: FootTarget[], pole: V3) {
  for (const ft of feet) legToward(skel, q, ft, pole)
}

/** feet flat on the mat `half` m either side of the midline, as far along +Z as gives this knee flexion */
export function plantFeet(skel: Skeleton, q: Float64Array, hipZ: number, knee: number, half: number, toe = 8, floor = MAT_TOP): { feet: FootTarget[]; contacts: Contact[] } {
  const at = (z: number) => [plantFoot(skel, 'l', [half, 0, z], toe, floor), plantFoot(skel, 'r', [-half, 0, z], toe, floor)]
  const z = root1d((zz) => {
    legsToward(skel, q, at(zz), [0, 1, 0])
    return q[skel.dof['knee_l.flex']] - knee
  }, hipZ + 0.1, hipZ + 0.95, { tol: 1e-7 }).x
  const feet = at(z)
  legsToward(skel, q, feet, [0, 1, 0])
  return { feet, contacts: footContacts(skel, feet) }
}

/** heel and ball contacts at their world targets from the foot placement */
export function footContacts(skel: Skeleton, feet: FootTarget[], sites = ['heel', 'ball']): Contact[] {
  const out: Contact[] = []
  for (const ft of feet) for (const site of sites) {
    const name = `${site}_${ft.side}`
    out.push({ site: name, kind: 'planted', target: { world: add(ft.ankle, qrot(ft.rot, skel.data.sites[name].local)) } })
  }
  return out
}

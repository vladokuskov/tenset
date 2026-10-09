import { handFrame } from '../constraints.ts'
import { segPos, type FK } from '../fk.ts'
import { siteWorld, type ImplementSpec } from '../implements.ts'
import { bandPose, gymRings, ringAnchor, ringPose, RING, type RingAnchorSpec } from '../implements/index.ts'
import { add, cross, DEG, dot, norm, qaxis, qid, qrot, reject, RAD, signedAngle, sub, type V3 } from '../math.ts'
import type { Contact, ImplementPose, Skeleton } from '../skeleton.ts'

// Gymnastic rings for the bodyweight templates (ring push-up, ring dip, ring triceps extension): the rig and both rings
// with their straps (implements/portable-c.ts), the grip contacts, and the rings posed in the hands every frame.
// A ring hangs along its strap with the hand closed on its bottom; where the forearm would run up inside the ring's
// plane (supports, push-ups) the forearm pushes the ring round its grip until its top clears the forearm, as a real
// ring rests against the wrist and forearm, so the ring leans off the strap line by up to RING_LEAN.

/** the least angle between the strap and the forearm round the grip, deg: less and the ring's top meets the forearm */
export const RING_LEAN = 26

export type RingRig = { anchor: RingAnchorSpec; anchorPose: ImplementPose; implements: ImplementSpec[] }

/** strap spread for grips `half` m either side: the strap points above the leaning rings' tops, so the straps hang
 * outside the arms */
export const ringSpread = (half: number) => 2 * (half + (2 * RING.R + RING.r) * Math.sin(RING_LEAN * DEG))

/**
 * both rings on a rig whose strap points sit above z at `spread` apart; `height` the beam's centre line; `mount` beam =
 * the crossbar alone (above the frame), rig = on two uprights with floor feet
 */
export function ringRig(o: { z: number; height?: number; spread?: number; mount?: 'beam' | 'rig' }): RingRig {
  const anchor = ringAnchor({ height: o.height, spread: o.spread, mount: o.mount })
  return { anchor, anchorPose: { id: anchor.id, pos: [0, 0, o.z], rot: qid() }, implements: [anchor, ...gymRings({ anchor: anchor.id })] }
}

export function ringContacts(): Contact[] {
  return [
    { site: 'grip_l', kind: 'grip', target: { implement: 'ring_l', grip: 'grip' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'ring_r', grip: 'grip' } },
  ]
}

/** the anchor's strap point above one ring, world */
export const strapTop = (rig: RingRig, side: 'l' | 'r'): V3 => siteWorld(rig.anchor, rig.anchorPose, `strap_${side}`).pos

/**
 * The ring's up direction (grip to strap): along the strap, unless the strap runs within `lean` deg of the forearm
 * (seen along the grip axis); then turned round the axis to `lean` deg off the forearm on its `away` side (a fixed side,
 * so a strap running along the forearm never flips the ring from one side to the other; only a strap swinging more than
 * `lean` past the forearm to the other side would, which no template does)
 */
export function ringUp(axis: V3, strap: V3, forearm: V3, lean: number, away: V3): V3 {
  const a = norm(axis)
  const s = norm(reject(strap, a)), f = norm(reject(forearm, a))
  const ang = signedAngle(f, s, a) * RAD
  const sign = dot(cross(a, f), away) >= 0 ? 1 : -1
  if (ang * sign >= lean || ang * sign <= -lean) return s
  return qrot(qaxis(a, sign * lean * DEG), f)
}

/**
 * poses of the rig, both rings in the hands (each leaning off its forearm towards `away`, the left side's direction,
 * mirrored for the right, as needed) and both straps
 */
export function ringPoses(skel: Skeleton, f: FK, rig: RingRig, away: V3 = [1, 0, 0], lean = RING_LEAN): ImplementPose[] {
  const out: ImplementPose[] = [rig.anchorPose]
  for (const side of ['l', 'r'] as const) {
    const spec = rig.implements.find((s) => s.id === `ring_${side}`)!
    const h = handFrame(skel, f, side)
    const top = strapTop(rig, side)
    const forearm = sub(segPos(skel, f, `forearm_${side}`), segPos(skel, f, `hand_${side}`))
    const up = ringUp(h.axis, sub(top, h.pos), forearm, lean, side === 'l' ? away : [-away[0], away[1], away[2]])
    out.push(ringPose(spec, h.pos, h.axis, add(h.pos, up)), bandPose(`strap_${side}`))
  }
  return out
}

/** the ring's lean off its strap, deg (for the tests) */
export function ringLean(rig: RingRig, pose: ImplementPose, side: 'l' | 'r'): number {
  const spec = rig.implements.find((s) => s.id === `ring_${side}`)!
  const grip = siteWorld(spec, pose, 'grip').pos
  const up = qrot(pose.rot, [0, 1, 0])
  return Math.acos(Math.min(1, dot(up, norm(sub(strapTop(rig, side), grip))))) * RAD
}

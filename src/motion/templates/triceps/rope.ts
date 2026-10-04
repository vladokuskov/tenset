import { handFrame, implementFromHand } from '../../constraints.ts'
import type { FK } from '../../fk.ts'
import type { ImplementSpec } from '../../implements.ts'
import { ROPE, ropeEnd, ropeFerrule, ropeStrand } from '../../implements/arms.ts'
import { add, dist, norm, scale, sub, type V3 } from '../../math.ts'
import type { Contact, ImplementPose, Skeleton } from '../../skeleton.ts'
import { frameY } from './common.ts'

// The spreading rope (implements/arms.ts): a ferrule on the cable, two free strands and two fist pieces that ride
// with the hands.

export const ROPE_IDS = { handle: 'handle', strands: ['strand_l', 'strand_r'], ends: ['end_l', 'end_r'] } as const

/** `free`: strand length, m (a longer rope than the default keeps the strands clear of the head when held by the temples) */
export function ropeImplements(free = ROPE.free): ImplementSpec[] {
  return [ropeFerrule(ROPE_IDS.handle), ...ROPE_IDS.strands.map((id) => ropeStrand(id, free)), ...ROPE_IDS.ends.map((id) => ropeEnd(id))]
}

export function ropeContacts(): Contact[] {
  return [
    { site: 'grip_l', kind: 'grip', target: { implement: 'end_l', grip: 'g' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'end_r', grip: 'g' } },
  ]
}

/**
 * Rope poses from the fists: the fist pieces ride with the hands, the ferrule hangs where the two free strands (fixed
 * length) meet on the line towards the pulley. For symmetric fists that is the static equilibrium: the strand
 * tensions' sideways parts cancel and the rest pulls straight against the cable.
 */
export function ropePoses(skel: Skeleton, f: FK, pulley: V3, free = ROPE.free, entryAt = ROPE.entry): ImplementPose[] {
  const hands = (['l', 'r'] as const).map((s) => handFrame(skel, f, s))
  const entry = hands.map((h) => add(h.pos, scale(h.axis, entryAt)))
  const mid = scale(add(entry[0], entry[1]), 0.5)
  const u = norm(sub(pulley, mid))
  const half = dist(entry[0], entry[1]) / 2
  const t = Math.sqrt(Math.max(free * free - half * half, 1e-4))
  const cap = add(mid, scale(u, t))
  return [
    { id: ROPE_IDS.handle, pos: add(cap, scale(u, -ROPE.cap.bottom)), rot: frameY(u) },
    ...entry.map((e, k) => ({ id: ROPE_IDS.strands[k], pos: cap, rot: frameY(norm(sub(cap, e))) })),
    ...hands.map((h, k) => ({ id: ROPE_IDS.ends[k], pos: h.pos, rot: implementFromHand(h.axis, h.palm) })),
  ]
}

/** where the rope's cable ends (the carabiner) */
export function ropeHandle(skel: Skeleton, f: FK, pulley: V3): ImplementPose {
  return ropePoses(skel, f, pulley)[0]
}

/** a cable stack column standing 0.12 m beyond the pulley, on the far side from the lifter (`behind`: the stack is behind) */
export function stackSpec(pulley: V3, behind: boolean): ImplementSpec {
  const z = pulley[2] + (behind ? -0.12 : 0.12)
  return { id: 'stack', kind: 'bench', mass: 0, com: [0, 0, 0], parts: [{ shape: 'cylinder', a: [0, 0, z], b: [0, 2.1, z], r: 0.05 }, { shape: 'cylinder', a: pulley, b: [0, pulley[1], z], r: 0.04 }], sites: {} }
}

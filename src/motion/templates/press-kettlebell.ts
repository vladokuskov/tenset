import { handFrame, implementFromHand, root1d } from '../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import type { FK } from '../fk.ts'
import type { ImplementSpec } from '../implements.ts'
import { kettlebell } from '../implements/index.ts'
import { DEG, qaxis, qmul, qrot, sub } from '../math.ts'
import type { Contact, ImplementPose, Skeleton } from '../skeleton.ts'
import type { Rest } from './types.ts'

// Kettlebell presses: the handle across the palm, the forearm through the window and the bell on the back of the
// forearm. The bell hangs from the handle, so it turns about the handle until it rests on the forearm (proximally,
// towards the elbow), whatever the wrist does.

export const KB_KG = 16
/** how far the bell presses into the back of the forearm, m */
const KB_SINK = 0.003
/** the bell's resting contact on the forearm and the back of the hand, mm (soft tissue under a 16 kg bell) */
export const KB_REST_TOL = 8

export const kbId = (s: 'l' | 'r') => `kb_${s}`

export function kettlebells(sides: ('l' | 'r')[], kg = KB_KG): ImplementSpec[] {
  return sides.map((s) => kettlebell({ id: kbId(s), kg }))
}

export function kbContacts(sides: ('l' | 'r')[]): Contact[] {
  return sides.map((s) => ({ site: `grip_${s}`, kind: 'grip', target: { implement: kbId(s), grip: 'handle' } }))
}

/** `upperArm`: in a standing rack the bell also rests against the upper arm */
export function kbRests(sides: ('l' | 'r')[], upperArm = false): Rest[] {
  return sides.map((s) => ({ implement: kbId(s), regions: [`forearm_${s}`, `hand_${s}`, ...(upperArm ? [`upperarm_${s}`] : [])], tol: KB_REST_TOL }))
}

/** the bell's slabs (the handle tubes are thin; the gripping hand is exempt from them) */
const bellParts = (spec: ImplementSpec) => ({ ...spec, parts: spec.parts.filter((p) => p.shape === 'cylinder' && p.r > 0.03) })

/**
 * Kettlebell pose in the hand: local X along the hand's handle axis, local Y towards the palm (the bell on the back
 * of the hand), then turned about the handle towards the elbow until the bell rests on the forearm. The turn runs
 * the other way for the right hand (its handle axis points the other way). `upperArm`: the bell stops on the upper arm
 * too (the standing rack, the bell in the crook of the elbow).
 */
export function kbInHand(skel: Skeleton, f: FK, side: 'l' | 'r', spec: ImplementSpec, upperArm = false): ImplementPose {
  const h = handFrame(skel, f, side)
  const base = implementFromHand(h.axis, h.palm)
  const handle = spec.sites.handle.pos
  const sign = side === 'l' ? 1 : -1
  const pose = (t: number): ImplementPose => {
    const rot = qmul(base, qaxis([1, 0, 0], sign * t * DEG))
    return { id: spec.id, pos: sub(h.pos, qrot(rot, handle)), rot }
  }
  const caps = bodyCapsules(skel, f).filter((c) => c.region === `forearm_${side}` || c.region === `hand_${side}` || (upperArm && c.region === `upperarm_${side}`))
  const bell = bellParts(spec)
  const clear = (t: number) => {
    const solids = placeParts(bell, pose(t))
    return Math.min(...solids.flatMap((s) => caps.map((c) => capsuleSolidClearance(c, s)))) + KB_SINK
  }
  // swinging towards the elbow from the hand's own frame (or back, if the bell already presses into the forearm)
  const r = clear(0) > 0 ? root1d(clear, 0, 90, { tol: 0.01, scan: 9 }) : root1d(clear, 0, -45, { tol: 0.01, scan: 5 })
  return pose(r.bracketed ? r.x : 0)
}

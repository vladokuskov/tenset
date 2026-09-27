import type { FK } from './fk.ts'
import { add, qconj, qmul, qpow, qrot, swingTwist, Y, type Quat, type V3 } from './math.ts'
import type { Skeleton } from './skeleton.ts'

export type BonePose = {
  /** root bone position in armature space (metres) */
  rootPosition: V3
  /** local rotation per MPFB2 bone (parent-relative, glTF node rotation); bones outside the map keep bind */
  local: Record<string, Quat>
}

type BoneEntry = { name: string; parent: string | null; seg: number; twist?: number; bindLocal: Quat; zeroWorld: Quat }

const cache = new WeakMap<Skeleton, { rootBone: string; order: BoneEntry[] }>()

function entries(skel: Skeleton) {
  let c = cache.get(skel)
  if (c) return c
  const twist = new Map<string, number>()
  for (const s of skel.segments) for (const b of s.bones) if (b.twist !== undefined) twist.set(b.name, b.twist)
  const order: BoneEntry[] = Object.entries(skel.data.bones).map(([name, b]) => ({
    name,
    parent: b.parent,
    seg: b.segment ? skel.seg[b.segment] : -1,
    twist: twist.get(name),
    bindLocal: b.bindLocal,
    zeroWorld: b.zeroWorld,
  }))
  const rootBone = order.find((b) => !b.parent)!.name
  c = { rootBone, order }
  cache.set(skel, c)
  return c
}

/**
 * Canonical FK -> MPFB2 bone local rotations. Rigid bones take their segment's rotation exactly. A proximal twist
 * bone (upperarm01, lowerarm01, upperleg01) takes only its `twist` share of the axial twist relative to its bind
 * orientation (swing-twist about the bone's own long axis), so the distal twist bone carries the rest.
 */
export function boneRotations(skel: Skeleton, f: FK): BonePose {
  const { rootBone, order } = entries(skel)
  const world = new Map<string, Quat>()
  const local: Record<string, Quat> = {}
  for (const b of order) {
    const parentW = b.parent ? world.get(b.parent)! : ([0, 0, 0, 1] as Quat)
    let loc: Quat
    if (b.seg < 0) {
      loc = b.bindLocal
    } else {
      const target = qmul(f.rot[b.seg], b.zeroWorld)
      loc = qmul(qconj(parentW), target)
      if (b.twist !== undefined) {
        const delta = qmul(qconj(b.bindLocal), loc)
        const { swing, twist } = swingTwist(delta, Y)
        loc = qmul(b.bindLocal, qmul(swing, qpow(twist, b.twist)))
      }
    }
    local[b.name] = loc
    world.set(b.name, qmul(parentW, loc))
  }
  return { rootPosition: f.pos[skel.seg[skel.data.bones[rootBone].segment!]], local }
}

/** world rotation and head position of every mapped bone, by chaining BonePose (for tests and debug views) */
export function boneWorld(skel: Skeleton, pose: BonePose): Map<string, { rot: Quat; head: V3 }> {
  const { order } = entries(skel)
  const out = new Map<string, { rot: Quat; head: V3 }>()
  for (const b of order) {
    const d = skel.data.bones[b.name]
    const p = b.parent ? out.get(b.parent)! : null
    const rot = p ? qmul(p.rot, pose.local[b.name]) : pose.local[b.name]
    const head: V3 = p ? add(p.head, qrot(p.rot, d.t)) : pose.rootPosition
    out.set(b.name, { rot, head })
  }
  return out
}


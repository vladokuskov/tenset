import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Baked } from '../../../motion/bake.ts'
import type { Part } from '../../../motion/implements.ts'
import type { ImplementPose } from '../../../motion/skeleton.ts'
import type { Piece } from './kit.ts'

// Drawn equipment around a baked motion: the scene composer draws each layout's pieces and the motion QA
// penetration gate collides with them (collision.ts). Family props and scene modules return layouts.

export type Poses = ReadonlyMap<string, ImplementPose>

export type ColliderKind = 'frame' | 'rail' | 'stack' | 'plate' | 'pad'

/** a collision primitive in a machine's frame; `pad` parts are padded supports (seats, pads, foot plates) */
export type Collider = Part & { kind: ColliderKind }

/** the machine as drawn (all pieces, in its frame) and the matrix placing it, as the composer builds it each frame */
export type MachineLayout = {
  /** the composer's prop key, unique in a scene */
  key: string
  /** implements of this machine the hands hold: a holding hand may close round its handles */
  holds: string[]
  /** the same pieces at every frame */
  fixed: boolean
  build: (poses: Poses) => { placement: Matrix4; pieces: Piece[] }
  /** the pieces that collide: without held implements and attachments */
  solid: (poses: Poses) => { placement: Matrix4; pieces: Piece[] }
  /** explicit collision primitives (in the placement frame) instead of the ones derived from `solid` pieces */
  colliders?: (poses: Poses) => Collider[]
  /** camera frames the whole prop (base and top), not only its floor parts */
  whole?: boolean
}

/** a family's or scene module's layouts for one baked motion */
export type LayoutSource = (b: Baked) => MachineLayout[]

const V = (v: readonly number[]) => new Vector3(v[0], v[1], v[2])

export function poseMatrix4(pose: { pos: readonly number[]; rot?: readonly number[] }) {
  const r = pose.rot
  return new Matrix4().compose(V(pose.pos), r ? new Quaternion(r[0], r[1], r[2], r[3]) : new Quaternion(), new Vector3(1, 1, 1))
}

/** pose of an implement at the first frame */
export function firstPose(b: Baked, id: string): ImplementPose | null {
  const k = b.implements.findIndex((s) => s.id === id)
  if (k < 0) return null
  const o = k * 7
  return { id, pos: [b.ip[o], b.ip[o + 1], b.ip[o + 2]], rot: [b.ip[o + 3], b.ip[o + 4], b.ip[o + 5], b.ip[o + 6]] }
}

/** a prop that stands still, drawn at an implement's pose (or a fixed placement) */
export function fixedLayout(key: string, placement: Matrix4, pieces: Piece[], o: Pick<MachineLayout, 'colliders' | 'whole'> & { holds?: string[] } = {}): MachineLayout {
  const r = { placement, pieces }
  return { key, holds: o.holds ?? [], fixed: true, build: () => r, solid: () => r, ...(o.colliders ? { colliders: o.colliders } : {}), ...(o.whole ? { whole: true } : {}) }
}

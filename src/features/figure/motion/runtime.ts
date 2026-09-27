import type { Bone, Quaternion } from 'three'
import { fk } from '../../../motion/fk.ts'
import { boneRotations } from '../../../motion/retarget.ts'
import type { ImplementPose, Skeleton } from '../../../motion/skeleton.ts'
import type { FigureHandle } from '../Figure'
import { gripLocals } from '../hands'
import type { MotionScene } from './compose'

/**
 * Drives the figure from a composed motion: every frame the baked loop is sampled, the canonical pose is retargeted
 * to MPFB2 bone rotations (src/motion/retarget.ts) and written straight onto the bones, the fingers take the grip
 * solved for each hand, correctives follow the new joint angles and the concentric pulse follows the phase.
 */
export class MotionRuntime {
  readonly scene: MotionScene
  private readonly skel: Skeleton
  private readonly figure: FigureHandle
  private readonly bones = new Map<string, Bone>()
  private readonly fingers: [Bone, Quaternion][] = []
  private readonly poses = new Map<string, ImplementPose>()

  constructor(scene: MotionScene, skel: Skeleton, figure: FigureHandle) {
    this.scene = scene
    this.skel = skel
    this.figure = figure
    for (const name of Object.keys(skel.data.bones)) {
      const b = figure.rig.bones.get(name)
      if (b) this.bones.set(name, b)
    }
    for (const g of scene.grips) for (const [name, q] of gripLocals(g.solution, g.side)) {
      const b = figure.rig.bones.get(name)
      if (b) this.fingers.push([b, q])
    }
  }

  /** pose the figure at loop fraction u; returns the implement poses for the props */
  update(u: number, pulse = true): ReadonlyMap<string, ImplementPose> {
    const pose = this.scene.poseAt(u)
    const target = boneRotations(this.skel, fk(this.skel, pose.q))
    for (const [name, b] of this.bones) {
      const q = target.local[name]
      b.quaternion.set(q[0], q[1], q[2], q[3])
    }
    const r = target.rootPosition
    this.figure.rig.root.position.set(r[0], r[1], r[2])
    for (const [b, q] of this.fingers) b.quaternion.copy(q)
    this.figure.correctives.update()
    this.figure.setPulse(pulse ? this.scene.pulseAt(u) : null)
    this.poses.clear()
    for (const p of pose.implements) this.poses.set(p.id, p)
    return this.poses
  }
}

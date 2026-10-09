import { Quaternion, Vector3 } from 'three'
import type { ImplementSpec, Part } from '../../../../motion/implements.ts'
import { finish, Kit, type PropBuild } from '../kit.ts'
import { firstPose, fixedLayout, poseMatrix4, type LayoutSource } from '../layout.ts'

// F9 core: prop builders (Kit pieces in the props materials) with their sockets, and the layouts that draw them
// around a baked motion. Layout pieces are also the QA penetration gate's collision primitives (collision.ts).

type Box = Extract<Part, { shape: 'box' }>
type Cyl = Extract<Part, { shape: 'cylinder' }>

/**
 * Decline sit-up board (implements/core.ts declineBoard), drawn from its parts so the contact surfaces match: the
 * padded board, the foam roller on a steel axle held by brackets from the board's edges, and the light frame (two
 * posts and a floor rail with rubber feet).
 */
export function buildDeclineBoard(spec: ImplementSpec): PropBuild<Record<string, never>> {
  const kit = new Kit()
  const [pad, roller, ...frame] = spec.parts as [Box, Cyl, ...Cyl[]]
  const rot = new Quaternion(...(pad.rot ?? [0, 0, 0, 1]))
  kit.box(pad.center, pad.size, 'pad', rot, 0.012)
  // the board's steel underframe, a little narrower than the pad
  const under = new Vector3(0, -pad.size[1] / 2 - 0.012, 0).applyQuaternion(rot).add(new Vector3(...pad.center))
  kit.box(under, [pad.size[0] * 0.55, 0.024, pad.size[2] * 0.96], 'frame', rot, 0.006)
  const a = new Vector3(...roller.a), b = new Vector3(...roller.b)
  const mid = a.clone().add(b).multiplyScalar(0.5)
  const half = a.distanceTo(b) / 2
  const along = b.clone().sub(a).normalize()
  // the foam roller on its axle
  kit.rod(a, b, roller.r, 'pad')
  kit.rod(mid.clone().addScaledVector(along, -half - 0.026), mid.clone().addScaledVector(along, half + 0.026), 0.011, 'steel')
  // brackets outside the rollers, from the board's edges up to the axle ends
  const normal = new Vector3(0, 1, 0).applyQuaternion(rot)
  for (const s of [-1, 1]) {
    const end = mid.clone().addScaledVector(along, s * (half + 0.018))
    const onPad = end.clone().addScaledVector(normal, -normal.dot(end.clone().sub(new Vector3(...pad.center))) - pad.size[1] / 2)
    kit.tube(onPad, end, 0.016, 0.03, 'frame')
  }
  for (const c of frame) kit.tube(c.a, c.b, 2 * c.r, 2 * c.r, 'frame')
  // rubber feet under the rail's ends
  const rail = frame[frame.length - 1]
  for (const p of [rail.a, rail.b]) kit.box([p[0], 0.008, p[2]], [0.5, 0.016, 0.06], 'rubber', undefined, 0.004)
  return finish(kit, {})
}

export const layouts: LayoutSource = (b) => {
  const spec = b.implements.find((s) => s.kind === 'decline_board')
  const pose = spec ? firstPose(b, spec.id) : null
  return spec && pose ? [fixedLayout(spec.id, poseMatrix4(pose), buildDeclineBoard(spec).pieces, { whole: true })] : []
}

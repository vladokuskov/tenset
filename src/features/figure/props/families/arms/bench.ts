import { Matrix4, Quaternion, Vector3 } from 'three'
import { DRAWN_BENCH } from '../../../../../motion/implements/arms.ts'
import { Kit } from '../../kit.ts'
import { firstPose, fixedLayout, poseMatrix4, type LayoutSource } from '../../layout.ts'
import { BENCH } from '../../sockets.ts'

// The adjustable bench, flat, as Kit pieces (the same shapes and materials as Bench.tsx at back 0), for benches the
// composer does not draw itself: cross_bench implements standing across the lifter (wrist curls).

/** flat adjustable bench in its own frame: seat centre on the floor at the origin, seat end towards +Z */
export function buildFlatBench(height: number) {
  const kit = new Kit()
  const { seat: SEAT, back: BACK, railY, frontZ, rearZ } = BENCH
  const tube = (a: Vector3, b: Vector3, w: number, d: number) => kit.tube(a, b, w, d, 'frame', { side: [1, 0, 0], r: Math.min(w, d) * 0.2 })
  for (const z of [frontZ, rearZ]) {
    tube(new Vector3(-0.24, 0.035, z), new Vector3(0.24, 0.035, z), 0.05, 0.07)
    for (const x of [-1, 1]) kit.box([x * 0.25, 0.017, z], [0.07, 0.035, 0.06], 'rubber', undefined, 0.012)
  }
  const railFront = new Vector3(0, railY, frontZ - 0.04)
  const railRear = new Vector3(0, railY, rearZ + 0.04)
  tube(new Vector3(0, 0.05, frontZ), railFront, 0.07, 0.05)
  tube(new Vector3(0, 0.05, rearZ), railRear, 0.07, 0.05)
  tube(railFront, railRear, 0.08, 0.06)
  tube(new Vector3(0, railY, 0.04), new Vector3(0, height - SEAT.thick - 0.03, 0.02), 0.07, 0.05)
  // back strut a third of the way along the flat pad
  const hinge = new Vector3(0, height - SEAT.thick, -SEAT.len / 2)
  const strutTop = hinge.clone().add(new Vector3(0, -0.03, -0.18))
  const strutFoot = new Vector3(0, railY + 0.03, Math.max(rearZ + 0.12, strutTop.z - 0.22 - 0.05))
  tube(strutFoot, strutTop, 0.06, 0.045)
  const pin = strutFoot.clone().add(new Vector3(0, 0.02, 0))
  kit.rod(pin.clone().add(new Vector3(-0.045, 0, 0)), pin.clone().add(new Vector3(0.045, 0, 0)), 0.012, 'frameDark', 16)
  kit.box([0, height - SEAT.thick / 2, 0], [SEAT.width, SEAT.thick, SEAT.len], 'pad', undefined, 0.022)
  kit.box([0, height - SEAT.thick - 0.006, 0], [SEAT.width - 0.04, 0.012, SEAT.len - 0.04], 'frameDark', undefined, 0.002)
  const backZ = hinge.z - (BACK.len / 2 + 0.01)
  kit.box([0, height - BACK.thick / 2, backZ], [BACK.width, BACK.thick, BACK.len], 'pad', undefined, 0.022)
  kit.box([0, height - SEAT.thick - 0.012, backZ], [BACK.width - 0.05, 0.012, BACK.len - 0.06], 'frameDark', undefined, 0.002)
  return kit.pieces
}

export const crossBenchLayouts: LayoutSource = (b) =>
  b.implements
    .filter((s) => s.kind === 'cross_bench')
    .map((spec) => {
      const pose = firstPose(b, spec.id)!
      const height = pose.pos[1]
      // implement origin: the hinge on the seat surface; the drawn bench's origin: the seat centre on the floor
      const placement = poseMatrix4(pose).multiply(new Matrix4().compose(new Vector3(0, -height, DRAWN_BENCH.seat.len / 2), new Quaternion(), new Vector3(1, 1, 1)))
      return fixedLayout(spec.id, placement, buildFlatBench(height))
    })

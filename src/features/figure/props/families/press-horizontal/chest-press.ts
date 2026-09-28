import { Matrix4, Quaternion, Vector3 } from 'three'
import { CHEST_PRESS } from '../../../../../motion/implements/press-horizontal.ts'
import { finish, Kit, type PropBuild } from '../../kit.ts'
import { cableRun, foot, pulley, WHEEL_R, weightStack } from '../../parts.ts'
import type { GripSocket, SurfaceSocket } from '../../sockets.ts'

// Seated chest press as the horizontal-press template lays it out: seat and reclined back pad on a floor spine, the
// weight stack in a tower behind the back pad, and two lever arms pivoting on brackets near the floor in front of
// the seat (outside the lifter's feet) that carry vertical handles at chest height. A cam on each pivot winds a
// cable that runs back along the side rail and up the tower to the stack. Frame: X across, Y up, the lifter faces
// +Z; origin on the floor under the seat's rear edge. The levers turn about X through `pivot` by `swing` deg.

type V3 = [number, number, number]

export type ChestPressParams = {
  seatHeight: number
  /** back pad lean from vertical, deg */
  recline: number
  /** the back pad's front surface at its bottom edge */
  backBottom: V3
  pivot: V3
  /** lever length from the pivot axis to the handle centres, m */
  reach: number
  /** handle centres |x|, m */
  gripHalf: number
  swing: number
  /** how far the selected plates ride up, m */
  stackLift?: number
}

export type ChestPressSockets = { seat: SurfaceSocket; back: SurfaceSocket; grips: Record<'l' | 'r', GripSocket> }

const TOWER = { z: -0.42, x: 0.2, top: 1.55 }
const LEVER = { w: 0.06, d: 0.05 }
/** cam radius on each pivot: the stack rises CAM_R x the lever turn (rad) */
export const CAM_R = 0.09

/** the lever pair and both handles in the lever frame (pivot at the origin, lever along +Y) */
function levers(kit: Kit, o: ChestPressParams) {
  const { armX, handle } = CHEST_PRESS
  const g = o.gripHalf
  const topY = o.reach + handle.len / 2 + 0.03
  for (const s of [-1, 1]) {
    const x = s * armX
    kit.rod([x - s * 0.03, 0, 0], [x + s * 0.03, 0, 0], 0.04, 'frameDark', 28)
    kit.rod([x + s * 0.03, 0, 0], [x + s * 0.045, 0, 0], CAM_R, 'frameDark', 40)
    kit.tube([x, -0.03, 0], [x, topY + LEVER.d / 2, 0], LEVER.w, LEVER.d, 'frame', { side: [1, 0, 0], cap: 'b' })
    // top stub inward to the handle, which hangs from it
    kit.tube([x - s * LEVER.w / 2, topY, 0], [s * (g - 0.02), topY, 0], 0.045, 0.04, 'frame', { side: [0, 0, 1], cap: 'b' })
    kit.rod([s * g, o.reach + handle.len / 2, 0], [s * g, topY - 0.02, 0], 0.018, 'steel', 20)
    kit.knurl([s * g, o.reach - handle.len / 2, 0], [s * g, o.reach + handle.len / 2, 0], handle.r)
    kit.rod([s * g, o.reach - handle.len / 2 - 0.012, 0], [s * g, o.reach - handle.len / 2, 0], handle.r + 0.004, 'rubber', 20)
  }
}

export function buildChestPress(o: ChestPressParams): PropBuild<ChestPressSockets> {
  const kit = new Kit()
  const { seat, back, armX } = CHEST_PRESS
  const piv = new Vector3(...o.pivot)
  const a = (o.recline * Math.PI) / 180
  const up = new Vector3(0, Math.cos(a), -Math.sin(a))
  const fwd = new Vector3(0, Math.sin(a), Math.cos(a))
  const bottom = new Vector3(...o.backBottom)
  const railX = armX + 0.085

  // base: spine along Z under the seat, a cross foot under the tower, side rails out to the pivot brackets
  kit.tube([0, 0.03, TOWER.z - 0.18], [0, 0.03, seat.len + 0.04], 0.08, 0.06, 'frame', { side: [1, 0, 0], cap: 'both' })
  kit.tube([-railX, 0.025, TOWER.z], [railX, 0.025, TOWER.z], 0.07, 0.05, 'frame', { side: [0, 0, 1], cap: 'both' })
  for (const s of [-1, 1]) {
    const x = s * railX
    kit.tube([x, 0.025, TOWER.z - 0.04], [x, 0.025, piv.z + 0.12], 0.06, 0.05, 'frame', { side: [1, 0, 0], cap: 'both' })
    foot(kit, [x, 0, TOWER.z - 0.02])
    foot(kit, [x, 0, piv.z + 0.09])
    // pivot bracket and bearing outside the lever
    kit.box([x, (piv.y + 0.07) / 2, piv.z], [0.03, piv.y + 0.07, 0.12], 'frame', undefined, 0.006)
    kit.rod([s * (armX + 0.045), piv.y, piv.z], [s * (armX + 0.1), piv.y, piv.z], 0.028, 'frameDark', 24)
  }

  // seat on a post from the spine
  const sh = o.seatHeight
  kit.box([0, sh - seat.thick / 2, seat.len / 2], [seat.width, seat.thick, seat.len], 'pad', undefined, 0.026)
  kit.box([0, sh - seat.thick - 0.006, seat.len / 2], [seat.width - 0.04, 0.012, seat.len - 0.04], 'frameDark', undefined, 0.004)
  kit.tube([0, 0.06, seat.len / 2], [0, sh - seat.thick - 0.012, seat.len / 2], 0.07, 0.07, 'frame')
  kit.knob([0, 0.24, seat.len / 2 + 0.035], [0, 0, 1], 0.014)

  // back pad and its frame, leaning back by `recline`
  const backC = bottom.clone().addScaledVector(up, back.len / 2).addScaledVector(fwd, -back.thick / 2)
  const rot = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -a)
  kit.box(backC, [back.width, back.len, back.thick], 'pad', rot, 0.026)
  kit.box(backC.clone().addScaledVector(fwd, -back.thick / 2 - 0.006), [back.width - 0.05, back.len - 0.05, 0.012], 'frameDark', rot, 0.004)
  const brace = backC.clone().addScaledVector(fwd, -back.thick / 2 - 0.04)
  kit.tube([0, 0.06, TOWER.z + 0.1], brace.clone().addScaledVector(up, 0.1), 0.06, 0.05, 'frame', { side: [1, 0, 0] })
  kit.tube(brace.clone().addScaledVector(up, -back.len / 2 + 0.08), brace.clone().addScaledVector(up, back.len / 2 - 0.06), 0.05, 0.04, 'frame', { side: [1, 0, 0] })

  // tower and stack behind the back pad
  for (const s of [-1, 1]) kit.tube([s * TOWER.x, 0.05, TOWER.z], [s * TOWER.x, TOWER.top, TOWER.z], 0.07, 0.07, 'frame', { cap: 'b' })
  kit.tube([-TOWER.x - 0.035, TOWER.top + 0.035, TOWER.z], [TOWER.x + 0.035, TOWER.top + 0.035, TOWER.z], 0.07, 0.07, 'frame', { side: [0, 0, 1], cap: 'both' })
  const stackTop = weightStack(kit, [0, 0, TOWER.z], { top: TOWER.top - 0.02, lift: o.stackLift, plates: 12 })
  const rearZ = TOWER.z - 0.08
  const topWheel = new Vector3(0, TOWER.top - 0.08, TOWER.z - 0.04)
  const lowWheel = new Vector3(0, piv.y + CAM_R, rearZ)
  pulley(kit, topWheel, [1, 0, 0])
  pulley(kit, lowWheel, [0, 0, 1])

  // levers and handles
  const m = new Matrix4().compose(piv, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (o.swing * Math.PI) / 180), new Vector3(1, 1, 1))
  const arm = new Kit()
  levers(arm, o)
  kit.merge(arm, m)

  // cables: off the top of each cam, back along the rails, in to the rear wheel, up the tower and down to the stack
  const camX = armX + 0.0375
  for (const s of [-1, 1]) {
    const corner = new Vector3(s * camX, lowWheel.y, rearZ)
    pulley(kit, corner, [0, 1, 0], 0.03)
    cableRun(kit, [new Vector3(s * camX, piv.y + CAM_R, piv.z), corner, new Vector3(s * WHEEL_R, lowWheel.y, rearZ)])
  }
  cableRun(kit, [new Vector3(0, lowWheel.y + WHEEL_R, rearZ), new Vector3(0, topWheel.y, topWheel.z - WHEEL_R)])
  cableRun(kit, [new Vector3(0, topWheel.y + WHEEL_R, topWheel.z), new Vector3(0, topWheel.y + WHEEL_R, stackTop.z), stackTop])

  const handleRot = new Quaternion().setFromRotationMatrix(m)
  const grip = (s: number): GripSocket => ({ position: new Vector3(s * o.gripHalf, o.reach, 0).applyMatrix4(m), axis: new Vector3(0, 1, 0).applyQuaternion(handleRot) })
  return finish(kit, {
    seat: { position: new Vector3(0, sh, seat.len / 2), normal: new Vector3(0, 1, 0), along: new Vector3(0, 0, 1), size: [seat.len, seat.width] },
    back: { position: bottom.clone().addScaledVector(up, back.len / 2), normal: fwd, along: up, size: [back.len, back.width] },
    grips: { l: grip(1), r: grip(-1) },
  })
}

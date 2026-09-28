import { Vector3 } from 'three'
import { PRESS_MACHINE, type PressGeometry } from '../../../../../motion/implements/press-vertical-bodyweight.ts'
import { finish, Kit, type PropBuild } from '../../kit.ts'
import { cableRun, foot, weightStack } from '../../parts.ts'
import type { GripSocket } from '../../sockets.ts'

// Seated shoulder press, lever type: two press arms on one shaft behind the seat, handles at their front ends, a
// cam on the shaft winding the cable that lifts the weight stack in the column behind. Seat and back pad at the
// template's implement boxes (implements/press-vertical-bodyweight.ts). World frame: the lifter faces +Z.

/** cam radius on the shaft: stack lift = CAM_R x lever angle (rad) */
const CAM_R = 0.08
const COLUMN_X = 0.2
const BEAM = { w: 0.08, d: 0.05 }
/** front cross member, under the seat's front edge (the feet stand ahead of it) */
const FRONT = 0.22

/** pieces the hands hold come first, so collision can leave them out */
export const HELD_PIECES = 2

export function buildShoulderPress(g: PressGeometry, angle: number): PropBuild<{ grips: Record<string, GripSocket> }> {
  const kit = new Kit()
  const { arm, lever, handleR, inner, seat, back } = PRESS_MACHINE
  const a = (angle * Math.PI) / 180
  const dir = new Vector3(0, Math.sin(a), Math.cos(a))
  const P = new Vector3(...g.pivot)
  const along = (x: number, t: number) => P.clone().setX(x).addScaledVector(dir, t)
  const x0 = Math.max(0.12, g.half - inner)
  for (const s of [1, -1]) kit.rod(along(s * x0, arm), along(s * lever, arm), handleR, 'handle', 24)

  // press arms, end caps, shaft, cam
  for (const s of [1, -1]) {
    kit.tube(along(s * lever, -0.05), along(s * lever, arm + 0.03), 0.05, 0.07, 'frame', { side: [1, 0, 0], cap: 'both' })
    kit.rod(along(s * (x0 - 0.006), arm), along(s * x0, arm), handleR + 0.005, 'rubber', 24)
  }
  kit.rod(P.clone().setX(-lever - 0.04), P.clone().setX(lever + 0.04), 0.022, 'steel')
  kit.wheel(P, [1, 0, 0], CAM_R, 0.03, 'frameDark')

  // column with the stack, brackets carrying the shaft
  const zc = g.pivot[2] - CAM_R
  const top = g.pivot[1] + 0.12
  for (const s of [-1, 1]) {
    kit.tube([s * COLUMN_X, 0.05, zc], [s * COLUMN_X, top, zc], 0.06, 0.06, 'frame', { cap: 'b' })
    kit.tube([s * COLUMN_X, g.pivot[1], zc + 0.03], [s * COLUMN_X, g.pivot[1], g.pivot[2] + 0.03], 0.06, 0.05, 'frame', { side: [1, 0, 0], cap: 'b' })
    kit.rod(P.clone().setX(s * (COLUMN_X + 0.035)), P.clone().setX(s * (COLUMN_X + 0.05)), 0.03, 'frameDark', 24)
  }
  kit.tube([-COLUMN_X - 0.03, top - 0.03, zc], [COLUMN_X + 0.03, top - 0.03, zc], 0.06, 0.06, 'frame', { side: [0, 0, 1], cap: 'both' })
  const stackTop = weightStack(kit, [0, 0, zc], { top: g.pivot[1] - 0.15, lift: CAM_R * a, plates: 14 })
  cableRun(kit, [stackTop, new Vector3(0, g.pivot[1], zc)])

  // base: spine beam, rear cross member under the column, front cross member
  const rear = zc - 0.2
  kit.tube([0, BEAM.d / 2, rear], [0, BEAM.d / 2, FRONT + 0.05], BEAM.w, BEAM.d, 'frame', { side: [1, 0, 0], cap: 'both' })
  kit.tube([-0.42, BEAM.d / 2, zc], [0.42, BEAM.d / 2, zc], BEAM.w, BEAM.d, 'frame', { side: [0, 0, 1], cap: 'both' })
  kit.tube([-0.3, BEAM.d / 2, FRONT], [0.3, BEAM.d / 2, FRONT], BEAM.w, BEAM.d, 'frame', { side: [0, 0, 1], cap: 'both' })
  for (const x of [-0.38, 0.38]) foot(kit, [x, 0, zc])
  for (const x of [-0.26, 0.26]) foot(kit, [x, 0, FRONT])
  foot(kit, [0, 0, rear + 0.04])

  // seat on its post
  const seatY = g.seat - seat[1] / 2
  kit.tube([0, BEAM.d, 0.04], [0, seatY - seat[1] / 2 - 0.012, 0.04], 0.07, 0.07, 'frame')
  kit.box([0, seatY - seat[1] / 2 - 0.006, 0.04], [seat[0] - 0.04, 0.012, seat[2] - 0.04], 'frameDark', undefined, 0.003)
  kit.box([0, seatY, 0.04], seat, 'pad', undefined, 0.025)

  // back pad on a post rising behind it
  const b = new Vector3(...g.back)
  const postZ = b.z - back[2] / 2 - 0.09
  kit.tube([0, BEAM.d, postZ], [0, b.y + 0.12, postZ], 0.07, 0.07, 'frame', { cap: 'b' })
  for (const dy of [-0.18, 0.18]) kit.tube([0, b.y + dy, postZ + 0.035], [0, b.y + dy, b.z - back[2] / 2 - 0.012], 0.05, 0.04, 'frame', { side: [1, 0, 0] })
  kit.box([0, b.y, b.z - back[2] / 2 - 0.006], [back[0] - 0.04, back[1] - 0.04, 0.012], 'frameDark', undefined, 0.003)
  kit.box(b, back, 'pad', undefined, 0.025)

  const grip = (s: number): GripSocket => ({ position: along(s * g.half, arm), axis: new Vector3(1, 0, 0) })
  return finish(kit, { grips: { l: grip(1), r: grip(-1) } })
}

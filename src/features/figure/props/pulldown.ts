import { Vector3 } from 'three'
import type { ImplementSpec } from '../../../motion/implements.ts'
import { hangAttachment, type AttachmentKind, type HandlePose } from './cable'
import { finish, Kit, vec, type PropBuild } from './kit'
import { cableRun, foot, pulley, WHEEL_R, weightStack } from './parts'
import type { CableSocket, GripSocket, SurfaceSocket } from './sockets'

// Lat pulldown laid out as the vertical-pull template's station: seat at the origin, thigh rollers in front, the
// stack tower behind the lifter and a boom carrying the high pulley forward over the head. Frame: X across, Y up,
// the lifter faces +Z.

type V3 = [number, number, number]

export type LatPulldownParams = {
  /** seat pad top height (m) */
  seatHeight?: number
  /** thigh roller axle centre */
  pad?: V3
  /** where the cable leaves the high pulley (the template's pulley point) */
  pulley?: V3
  attachment?: AttachmentKind | null
  attachmentSpec?: ImplementSpec
  /** attachment origin pose; default: arms-up start, hanging along the cable */
  handle?: HandlePose
  stackLift?: number
}

export const latPulldownDefaults = { seatHeight: 0.43, pad: [0, 0.633, 0.355] as V3, pulley: [0, 2.4, 0.142] as V3, attachment: 'long_bar' as AttachmentKind }

export const PULLDOWN = { towerZ: -0.5, postX: 0.2, boomY: 2.52, seatZ: 0.05, rollerR: 0.06 }

export type LatPulldownSockets = {
  seat: SurfaceSocket
  /** thigh roller axle (along X) and the rollers' underside contact line centre */
  thighPad: { axle: Vector3; radius: number; contact: SurfaceSocket }
  cable: CableSocket
  grips: Record<string, GripSocket>
  eye: Vector3
}

export function buildLatPulldown(p: LatPulldownParams = {}): PropBuild<LatPulldownSockets> {
  const o = { ...latPulldownDefaults, ...p }
  const kit = new Kit()
  const { towerZ, postX, boomY, seatZ, rollerR } = PULLDOWN
  const R = WHEEL_R
  const pad = vec(o.pad)
  const exit = vec(o.pulley)
  const front = new Vector3(0, exit.y, exit.z - R)
  const rear = new Vector3(0, exit.y, towerZ + R)

  // base: spine along Z, cross feet under the tower and the rollers
  kit.tube([0, 0.025, towerZ - 0.2], [0, 0.025, pad.z + 0.12], 0.08, 0.05, 'frame', { side: [1, 0, 0], cap: 'both' })
  for (const [z, half] of [[towerZ, 0.34], [pad.z + 0.06, 0.3]] as const) {
    kit.tube([-half, 0.025, z], [half, 0.025, z], 0.07, 0.05, 'frame', { side: [0, 0, 1], cap: 'both' })
    foot(kit, [-half + 0.04, 0, z])
    foot(kit, [half - 0.04, 0, z])
  }

  // tower, stack, boom and pulleys
  for (const s of [-1, 1]) kit.tube([s * postX, 0.05, towerZ], [s * postX, boomY - 0.04, towerZ], 0.07, 0.07, 'frame')
  kit.tube([-postX - 0.035, boomY, towerZ], [postX + 0.035, boomY, towerZ], 0.08, 0.08, 'frame', { side: [0, 0, 1], cap: 'both' })
  kit.tube([-postX + 0.035, 2.25, towerZ], [postX - 0.035, 2.25, towerZ], 0.05, 0.05, 'frame', { side: [0, 0, 1] })
  kit.tube([0, boomY, towerZ - 0.09], [0, boomY, exit.z + 0.03], 0.08, 0.08, 'frame', { side: [1, 0, 0], cap: 'both' })
  const stackTop = weightStack(kit, [0, 0, towerZ], { top: 2.225, lift: p.stackLift, plates: 15 })
  pulley(kit, rear, [1, 0, 0])
  pulley(kit, front, [1, 0, 0])
  for (const w of [rear, front]) kit.rod([0, w.y + 0.06, w.z], [0, boomY - 0.04, w.z], 0.012, 'steel', 16)
  cableRun(kit, [stackTop, new Vector3(0, rear.y, towerZ)])
  cableRun(kit, [new Vector3(0, rear.y + R, rear.z), new Vector3(0, front.y + R, front.z)])

  const handle = p.handle ?? { pos: [0, 1.7, 0.11] }
  const hung = hangAttachment(kit, front, handle, { attachment: o.attachment, spec: p.attachmentSpec, plane: () => new Vector3(0, 0, 1), wrap: 'cw' })

  // seat on an adjustable post
  const sh = o.seatHeight
  kit.box([0, sh - 0.035, seatZ], [0.4, 0.07, 0.38], 'pad', undefined, 0.026)
  kit.box([0, sh - 0.076, seatZ], [0.36, 0.012, 0.34], 'frameDark', undefined, 0.004)
  kit.tube([0, 0.05, seatZ], [0, sh - 0.082, seatZ], 0.06, 0.06, 'frame')
  kit.tube([0, 0.05, seatZ], [0, 0.26, seatZ], 0.08, 0.08, 'frame', { cap: 'b' })
  kit.knob([0, 0.2, seatZ + 0.04], [0, 0, 1], 0.014)

  // thigh rollers on an adjustable post
  for (const s of [-1, 1]) {
    kit.rod([s * 0.045, pad.y, pad.z], [s * 0.29, pad.y, pad.z], rollerR, 'pad', 32)
    kit.rod([s * 0.29, pad.y, pad.z], [s * 0.296, pad.y, pad.z], 0.03, 'steel', 24)
  }
  kit.rod([-0.3, pad.y, pad.z], [0.3, pad.y, pad.z], 0.014, 'steel', 16)
  kit.box([0, pad.y, pad.z], [0.07, 0.07, 0.07], 'frameDark', undefined, 0.01)
  kit.tube([0, 0.05, pad.z], [0, pad.y - 0.035, pad.z], 0.05, 0.05, 'frame')
  kit.tube([0, 0.05, pad.z], [0, 0.34, pad.z], 0.07, 0.07, 'frame', { cap: 'b' })
  kit.knob([0, 0.29, pad.z + 0.035], [0, 0, 1], 0.014)

  return finish(kit, {
    seat: { position: new Vector3(0, sh, seatZ), normal: new Vector3(0, 1, 0), along: new Vector3(0, 0, 1), size: [0.38, 0.4] },
    thighPad: { axle: pad, radius: rollerR, contact: { position: pad.clone().add(new Vector3(0, -rollerR, 0)), normal: new Vector3(0, -1, 0) } },
    cable: hung.cable,
    grips: hung.grips,
    eye: hung.eye,
  })
}

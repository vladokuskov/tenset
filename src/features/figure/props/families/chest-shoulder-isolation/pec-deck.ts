import { Vector3 } from 'three'
import { PEC_DECK } from '../../../../../motion/implements/chest-shoulder-isolation.ts'
import type { ImplementSpec } from '../../../../../motion/implements.ts'
import { finish, Kit, type PropBuild } from '../../kit.ts'
import { cableRun, foot, pulley, weightStack } from '../../parts.ts'
import type { GripSocket, SurfaceSocket } from '../../sockets.ts'

// Pec deck / reverse pec deck: one machine, two modes. Frame as the pec_deck implement: X across, Y up, the pad face
// in the plane z = 0 facing +Z, the column and the stack behind it, a boom carrying the two pivot hubs forward over
// the lifter's shoulders. The arms (pec_deck_arm implements) are drawn from their own descriptors.

type V3 = [number, number, number]

/** stack tower behind the column, m */
const STACK_BEHIND = 0.62

export type PecDeckParams = {
  seatHeight: number
  pad: [number, number]
  pivot: { x: number; y: number; z: number }
  stackLift?: number
}

export type PecDeckSockets = { seat: SurfaceSocket; pad: SurfaceSocket; pivots: Record<'l' | 'r', Vector3> }

export function buildPecDeck(p: PecDeckParams): PropBuild<PecDeckSockets> {
  const kit = new Kit()
  const { pad, seat, column, hubDrop } = PEC_DECK
  const [y0, y1] = p.pad
  const cz = column.z, cw = column.w
  const top = p.pivot.y + hubDrop
  // the stack stands beyond the reach of the handles (the reverse mode's hands start well in front of the pad)
  const stackZ = cz - STACK_BEHIND
  const seatZ = seat.z0 + seat.len / 2

  // base: spine along Z, cross feet under the stack and in front of the seat
  kit.tube([0, 0.025, stackZ - 0.16], [0, 0.025, seatZ + 0.2], 0.08, 0.05, 'frame', { side: [1, 0, 0], cap: 'both' })
  for (const [z, half] of [[stackZ, 0.32], [seatZ + 0.14, 0.28]] as const) {
    kit.tube([-half, 0.025, z], [half, 0.025, z], 0.07, 0.05, 'frame', { side: [0, 0, 1], cap: 'both' })
    foot(kit, [-half + 0.04, 0, z])
    foot(kit, [half - 0.04, 0, z])
  }

  // column, top boom over the lifter and the pivot crossbar with the hub housings
  kit.tube([0, 0.05, cz], [0, top + 0.04, cz], cw, cw, 'frame', { cap: 'b' })
  kit.tube([0, top, cz - cw / 2], [0, top, p.pivot.z + 0.04], 0.08, 0.08, 'frame', { side: [1, 0, 0], cap: 'both' })
  kit.tube([-p.pivot.x - 0.05, top, p.pivot.z], [p.pivot.x + 0.05, top, p.pivot.z], 0.08, 0.08, 'frame', { side: [0, 0, 1], cap: 'both' })
  const pivots = { l: new Vector3(p.pivot.x, p.pivot.y, p.pivot.z), r: new Vector3(-p.pivot.x, p.pivot.y, p.pivot.z) }
  for (const c of Object.values(pivots)) {
    kit.rod(c.clone().setY(p.pivot.y + 0.001), c.clone().setY(top - 0.04), 0.045, 'frameDark', 32)
    kit.rod(c.clone().setY(top + 0.04), c.clone().setY(top + 0.05), 0.03, 'rubber', 24)
  }

  // stack tower behind the column, joined to it at the top; a cable runs up over a pulley to the boom
  for (const s of [-1, 1]) kit.tube([s * 0.2, 0.05, stackZ], [s * 0.2, 1.62, stackZ], 0.06, 0.06, 'frame')
  kit.tube([-0.23, 1.65, stackZ], [0.23, 1.65, stackZ], 0.06, 0.06, 'frame', { side: [0, 0, 1], cap: 'both' })
  kit.tube([0, 1.65, stackZ + 0.03], [0, 1.65, cz - cw / 2], 0.05, 0.05, 'frame', { side: [1, 0, 0] })
  kit.tube([0, 0.1, stackZ + 0.03], [0, 0.1, cz - cw / 2], 0.05, 0.05, 'frame', { side: [1, 0, 0] })
  kit.box([0, 0.048, stackZ], [0.34, 0.008, 0.18], 'frameDark', undefined, 0.003)
  const stackTop = weightStack(kit, [0, 0, stackZ], { top: 1.6, lift: p.stackLift, plates: 12 })
  const wheel = new Vector3(0, 1.72, stackZ)
  pulley(kit, wheel, [1, 0, 0])
  kit.rod([0, 1.65, stackZ], [0, wheel.y, stackZ], 0.012, 'steel', 16)
  cableRun(kit, [stackTop, wheel.clone().add(new Vector3(0, 0, 0.045))])

  // pad on a bracket from the column (height set per mode)
  const pc = (y0 + y1) / 2
  kit.box([0, pc, -pad.thick / 2], [pad.width, y1 - y0, pad.thick], 'pad', undefined, 0.026)
  kit.box([0, pc, -pad.thick - 0.006], [pad.width - 0.04, y1 - y0 - 0.04, 0.012], 'frameDark', undefined, 0.004)
  kit.tube([0, pc, -pad.thick - 0.012], [0, pc, cz + cw / 2], 0.06, 0.05, 'frame', { side: [1, 0, 0] })
  kit.box([0, pc, cz], [cw + 0.03, 0.12, cw + 0.03], 'frameDark', undefined, 0.012)
  kit.knob([cw / 2 + 0.015, pc, cz], [1, 0, 0], 0.016)

  // seat on an adjustable post from the spine
  const sh = p.seatHeight
  kit.box([0, sh - seat.thick / 2, seatZ], [seat.width, seat.thick, seat.len], 'pad', undefined, 0.026)
  kit.box([0, sh - seat.thick - 0.006, seatZ], [seat.width - 0.04, 0.012, seat.len - 0.04], 'frameDark', undefined, 0.004)
  kit.tube([0, 0.05, seatZ], [0, sh - seat.thick - 0.012, seatZ], 0.06, 0.06, 'frame')
  kit.tube([0, 0.05, seatZ], [0, 0.26, seatZ], 0.08, 0.08, 'frame', { cap: 'b' })
  kit.knob([0, 0.2, seatZ + 0.04], [0, 0, 1], 0.014)

  return finish(kit, {
    seat: { position: new Vector3(0, sh, seatZ), normal: new Vector3(0, 1, 0), along: new Vector3(0, 0, 1), size: [seat.len, seat.width] },
    pad: { position: new Vector3(0, pc, 0), normal: new Vector3(0, 0, 1), along: new Vector3(0, 1, 0), size: [y1 - y0, pad.width] },
    pivots,
  })
}

type Cyl = Extract<ImplementSpec['parts'][number], { shape: 'cylinder' }>

/** a pec deck arm in its own frame (origin at the pivot hub), from the implement: hub, lever, drop and foam grip */
export function buildPecDeckArm(spec: ImplementSpec): PropBuild<{ grip: GripSocket }> {
  const kit = new Kit()
  const [hub, lever, drop, grip] = spec.parts as Cyl[]
  kit.rod(hub.a, hub.b, hub.r, 'frameDark', 32)
  kit.tube(lever.a, lever.b, 2 * lever.r, 2 * lever.r, 'frame', { side: [1, 0, 0], cap: 'b' })
  kit.box(lever.b, [2 * lever.r + 0.012, 2 * lever.r + 0.012, 2 * lever.r + 0.012], 'frameDark', undefined, 0.008)
  kit.rod(drop.a, drop.b, drop.r, 'frame', 24)
  kit.rod(grip.a, grip.b, grip.r, 'pad', 28)
  kit.rod(grip.b, (grip.b as V3).map((v, i) => (i === 1 ? v - 0.01 : v)) as V3, grip.r + 0.004, 'rubber', 24)
  const s = spec.sites.h
  return finish(kit, { grip: { position: new Vector3(...s.pos), axis: new Vector3(...s.axis!) } })
}

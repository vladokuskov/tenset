import type { ImplementSpec, Part } from '../implements.ts'
import { add, DEG, type Quat, type V3 } from '../math.ts'

// F1 press-horizontal: the press bench at the drawn adjustable bench's dimensions, bench-press uprights, and the
// seated chest press (static frame with its seat and back pad, moving lever arms carrying the handles). The figure
// props (src/features/figure/props/families/press-horizontal/) draw them from these dimensions.

export const KINDS = ['bench_rack', 'chest_press', 'press_arms'] as const
export const MOVING: readonly string[] = ['press_arms']

/** the adjustable bench as drawn (props/sockets.ts BENCH; a test keeps them equal) */
export const PRESS_BENCH = { seat: { len: 0.32, width: 0.3, thick: 0.065 }, back: { len: 0.8, width: 0.27, thick: 0.065 }, gap: 0.01, frontZ: 0.28, rearZ: -0.72 }

/** where the drawn back pad's surface line meets the seat behind the hinge (props/collision.ts hingeShift) */
export function hingeShift(a: number, thick = PRESS_BENCH.back.thick) {
  return Math.abs(a) < 1e-9 ? 0 : (thick * (Math.cos(a) - 1)) / Math.sin(a)
}

/**
 * Press bench: the seat and back pad surfaces exactly where the composer draws the adjustable bench (the template
 * bench's seat is longer than the drawn one, which matters where the thighs leave it). Local origin on the seat
 * surface at the hinge line, +Z the seat end, the back pad folding back towards -Z; stabiliser feet on the floor.
 */
export function pressBench(o: { backAngle: number; seatHeight: number }): ImplementSpec {
  const { seat, back, gap, frontZ, rearZ } = PRESS_BENCH
  const a = o.backAngle * DEG
  const hs = hingeShift(a)
  const along: V3 = [0, Math.sin(a), -Math.cos(a)]
  const normal: V3 = [0, Math.cos(a), Math.sin(a)]
  const hinge: V3 = [0, -seat.thick, hs]
  const rot: Quat = [Math.sin(a / 2), 0, 0, Math.cos(a / 2)]
  const mid = back.len / 2 + gap
  const backCenter = add(hinge, add([0, along[1] * mid, along[2] * mid], [0, normal[1] * (back.thick / 2), normal[2] * (back.thick / 2)]))
  const seatZ = hs + seat.len / 2
  const h = o.seatHeight
  const parts: Part[] = [
    { shape: 'box', center: [0, -seat.thick / 2, seatZ], size: [seat.width, seat.thick, seat.len], pad: true },
    { shape: 'box', center: backCenter, size: [back.width, back.thick, back.len], rot, pad: true },
    { shape: 'box', center: [0, 0.035 - h, seatZ + frontZ], size: [0.55, 0.07, 0.07] },
    { shape: 'box', center: [0, 0.035 - h, seatZ + rearZ], size: [0.55, 0.07, 0.07] },
  ]
  const backSite = add(hinge, add([0, along[1] * mid, along[2] * mid], [0, normal[1] * back.thick, normal[2] * back.thick]))
  return { id: 'bench', kind: 'bench', mass: 0, com: [0, 0, 0], parts, sites: { seat: { pos: [0, 0, seatZ], normal: [0, 1, 0] }, back: { pos: backSite, normal } } }
}

/**
 * Bench-press uprights: two posts on a floor frame with J-cups facing +Z, where the lifter lies. Local origin on the
 * floor between the posts. The posts stand inside an Olympic bar's collars (0.64) so the bar racks between the plates.
 */
export const BENCH_RACK = { x: 0.53, post: 0.07, cup: 0.075, depth: 0.5, top: 0.16 }

/** drawn and collided by the family props from the layout; the implement carries the cup height */
export function benchRack(o: { hookHeight: number }): ImplementSpec {
  const { x, cup } = BENCH_RACK
  return {
    id: 'rack',
    kind: 'bench_rack',
    mass: 0,
    com: [0, 0, 0],
    parts: [],
    sites: { l: { pos: [x, o.hookHeight, cup], axis: [1, 0, 0] }, r: { pos: [-x, o.hookHeight, cup], axis: [1, 0, 0] } },
  }
}

/**
 * Seated chest press. Frame (implement 'machine', static): seat and back pad surfaces the body rests on; local origin
 * on the floor under the seat's rear edge, +Z where the lifter faces. The arms (implement 'handles', kind press_arms)
 * pivot about a transverse axis near the floor in front of the lifter and carry vertical handles; their local frame
 * sits between the handles and turns about X round the pivot axis below them.
 */
export const CHEST_PRESS = {
  seat: { len: 0.36, width: 0.38, thick: 0.07 },
  back: { len: 0.86, width: 0.34, thick: 0.07 },
  /** lever arm tubes |x|, the handles' vertical grip length and radius */
  armX: 0.5,
  handle: { len: 0.2, r: 0.016 },
  pivotY: 0.12,
}

export function chestPressFrame(o: { seatHeight: number; recline: number; backBottom: V3 }): ImplementSpec {
  const { seat, back } = CHEST_PRESS
  const a = o.recline * DEG
  // back pad: its front surface through backBottom, leaning back by `recline` from vertical
  const up: V3 = [0, Math.cos(a), -Math.sin(a)]
  const fwd: V3 = [0, Math.sin(a), Math.cos(a)]
  const c = add(o.backBottom, add([0, up[1] * (back.len / 2), up[2] * (back.len / 2)], [0, -fwd[1] * (back.thick / 2), -fwd[2] * (back.thick / 2)]))
  const rot: Quat = [Math.sin(-a / 2), 0, 0, Math.cos(-a / 2)]
  return {
    id: 'machine',
    kind: 'chest_press',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      { shape: 'box', center: [0, o.seatHeight - seat.thick / 2, seat.len / 2], size: [seat.width, seat.thick, seat.len], pad: true },
      { shape: 'box', center: c, size: [back.width, back.len, back.thick], rot, pad: true },
    ],
    sites: { seat: { pos: [0, o.seatHeight, seat.len / 2], normal: [0, 1, 0] }, back: { pos: add(o.backBottom, [0, up[1] * 0.3, up[2] * 0.3]), normal: fwd }, hinge: { pos: o.backBottom, axis: [1, 0, 0] } },
  }
}

/** lever arms: local origin midway between the handle centres (+-gripHalf, 0, 0), the pivot axis `reach` below them */
export function chestPressArms(o: { gripHalf: number; reach: number }): ImplementSpec {
  const { handle } = CHEST_PRESS
  const parts: Part[] = []
  const sites: ImplementSpec['sites'] = { pivot: { pos: [0, -o.reach, 0], axis: [1, 0, 0] } }
  for (const [s, x] of [['l', o.gripHalf], ['r', -o.gripHalf]] as const) {
    parts.push({ shape: 'cylinder', a: [x, -handle.len / 2, 0], b: [x, handle.len / 2, 0], r: handle.r })
    sites[s] = { pos: [x, 0, 0], axis: [0, 1, 0] }
  }
  return { id: 'handles', kind: 'press_arms', mass: 0, com: [0, 0, 0], parts, sites }
}

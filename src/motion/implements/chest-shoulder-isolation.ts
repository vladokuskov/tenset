import type { ImplementSpec, Part } from '../implements.ts'
import type { V3 } from '../math.ts'

// F3 chest-shoulder-isolation: the pec deck / reverse pec deck (one machine, two modes: the lifter sits with the
// back or the chest against the pad) and the cable crossover (two cable stacks). The figure props
// (src/features/figure/props/families/chest-shoulder-isolation) draw them at exactly these dimensions.
export const KINDS = ['pec_deck', 'pec_deck_arm', 'cable_crossover'] as const
export const MOVING: readonly string[] = ['pec_deck_arm']

const cyl = (a: V3, b: V3, r: number, pad?: boolean): Part => ({ shape: 'cylinder', a, b, r, ...(pad ? { pad: true } : {}) })

/**
 * Pec deck frame in its own frame: X across, Y up, the pad face in the plane z = 0 facing +Z (the lifter's side),
 * the column behind it. Padded parts: seat and pad. Sites: pivot hubs `pl` / `pr` (the arms turn about vertical
 * axes through them), seat top centre, pad face centre.
 */
export const PEC_DECK = {
  pad: { width: 0.3, thick: 0.07 },
  seat: { width: 0.36, len: 0.4, thick: 0.07, z0: 0.02 },
  column: { z: -0.2, w: 0.1 },
  /** hub below the top crossbar */
  hubDrop: 0.1,
  arm: { r: 0.021, grip: 0.24, gripR: 0.021, hub: 0.035 },
}

export type PecDeckOpts = {
  id?: string
  seatHeight: number
  /** pad bottom and top heights */
  pad: [number, number]
  /** pivot hubs: half the distance between them, height, distance in front of the pad face */
  pivot: { x: number; y: number; z: number }
}

export function pecDeck(o: PecDeckOpts): ImplementSpec {
  const { pad, seat } = PEC_DECK
  const [y0, y1] = o.pad
  const sz = seat.z0 + seat.len / 2
  return {
    id: o.id ?? 'pecdeck',
    kind: 'pec_deck',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      { shape: 'box', center: [0, o.seatHeight - seat.thick / 2, sz], size: [seat.width, seat.thick, seat.len], pad: true },
      { shape: 'box', center: [0, (y0 + y1) / 2, -pad.thick / 2], size: [pad.width, y1 - y0, pad.thick], pad: true },
    ],
    sites: {
      pl: { pos: [o.pivot.x, o.pivot.y, o.pivot.z], axis: [0, 1, 0] },
      pr: { pos: [-o.pivot.x, o.pivot.y, o.pivot.z], axis: [0, 1, 0] },
      seat: { pos: [0, o.seatHeight, sz], normal: [0, 1, 0] },
      pad: { pos: [0, (y0 + y1) / 2, 0], normal: [0, 0, 1] },
    },
  }
}

/**
 * One pec deck arm, local origin at its pivot hub: a lever out along +Z by `radius`, a drop down to a vertical
 * foam grip. Posed by a rotation about Y at the pivot. Site `h`: grip centre, axis up (little finger low).
 */
export function pecDeckArm(o: { id: string; radius: number; drop: number }): ImplementSpec {
  const { r, grip, gripR, hub } = PEC_DECK.arm
  const R = o.radius, D = o.drop
  return {
    id: o.id,
    kind: 'pec_deck_arm',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      cyl([0, -0.004, 0], [0, -0.05, 0], hub),
      cyl([0, -0.03, 0], [0, -0.03, R], r),
      cyl([0, -0.03, R], [0, -D + grip, R], r),
      cyl([0, -D + grip, R], [0, -D, R], gripR),
    ],
    sites: { h: { pos: [0, -D + grip / 2, R], axis: [0, 1, 0] } },
  }
}

/**
 * Cable crossover: two cable stacks (the single-column stack drawn by props/cable.ts) whose pulleys sit at the
 * sites `l` / `r` (the lifter's left and right towers), each facing `normal` (horizontal, towards the lifter).
 * No collision parts of its own: the drawn stacks are the colliders.
 */
export function cableCrossover(o: { id?: string; pulleys: { l: V3; r: V3 }; facing: { l: V3; r: V3 } }): ImplementSpec {
  return {
    id: o.id ?? 'crossover',
    kind: 'cable_crossover',
    mass: 0,
    com: [0, 0, 0],
    parts: [],
    sites: { l: { pos: o.pulleys.l, normal: o.facing.l }, r: { pos: o.pulleys.r, normal: o.facing.r } },
  }
}

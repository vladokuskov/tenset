import { cableHandle, type ImplementSpec, type Part } from '../implements.ts'
import type { V3 } from '../math.ts'

// F8 arms: implement factories (ImplementSpec geometry) for this family's templates. New implement kinds go in
// KINDS, and kinds that move with the hands in MOVING (the equipment-equipment check tests those against everything).
//
// Spreading rope (pushdowns, overhead cable extension): the ends spread and close over the rep, which a rigid
// attachment cannot do, so the rope is a ferrule (the cable handle), two free strands from it to the fists and two
// fist pieces that ride with the hands (through the fist, rubber stop past the little finger). The figure props
// (props/families/arms.ts) draw the strands and fist pieces at exactly these dimensions.

export const KINDS = ['rope_strand', 'rope_end', 'cross_bench'] as const
export const MOVING: readonly string[] = ['rope_end']

export const ROPE = {
  r: 0.012,
  /** fist piece, along the hand's little finger -> index line: rope enters `entry` in front of the grip centre */
  entry: 0.05,
  exit: 0.05,
  /** rubber stop past the little finger (a rod ending in a ball at `to`) */
  stop: { r: 0.021, from: 0.044, to: 0.084 },
  /** ferrule cap below the carabiner, handle frame */
  cap: { top: 0.004, bottom: -0.03, r: 0.017 },
  /** free strand from the ferrule cap to the fist, m */
  free: 0.26,
  /** the last few cm of a free strand disappear into the fist; its collision part stops short of them */
  tuck: 0.04,
}

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

/** rope ferrule: the cable handle the strands hang from (origin at the carabiner, +Y towards the pulley) */
export function ropeFerrule(id = 'handle'): ImplementSpec {
  const { top, bottom, r } = ROPE.cap
  return { ...cableHandle({ id, attachment: 'rope' }), parts: [cyl([0, top, 0], [0, bottom, 0], r)], sites: {} }
}

/** a free strand: origin at the ferrule cap, hanging along local -Y to the fist (its last `tuck` left out) */
export function ropeStrand(id: string, free = ROPE.free): ImplementSpec {
  return { id, kind: 'rope_strand', mass: 0, com: [0, 0, 0], parts: [cyl([0, 0, 0], [0, -(free - ROPE.tuck), 0], ROPE.r)], sites: {} }
}

/** the piece of rope in a fist: local X along the hand's little finger -> index line, origin at the grip centre */
export function ropeEnd(id: string): ImplementSpec {
  const { r, entry, exit, stop } = ROPE
  return {
    id,
    kind: 'rope_end',
    mass: 0.2,
    com: [0, 0, 0],
    parts: [cyl([entry, 0, 0], [-exit, 0, 0], r), cyl([-stop.from, 0, 0], [-(stop.to + 0.015), 0, 0], stop.r)],
    sites: { g: { pos: [0, 0, 0], axis: [1, 0, 0] } },
  }
}

/** the adjustable bench's pads as the composer draws them flat (props/sockets.ts BENCH: seat 0.32 x 0.30, back 0.80 x 0.27, 0.065 thick) */
export const DRAWN_BENCH = { seat: { len: 0.32, width: 0.3 }, back: { len: 0.8, width: 0.27 }, thick: 0.065, gap: 0.01 }

/**
 * Flat bench whose pads are exactly the drawn ones, so hands and knees can rest at their edges. Same frame as
 * implements.ts bench (origin at the hinge on the seat surface, +Z the seat end); the composer draws it as the
 * adjustable bench, flat.
 */
export function drawnFlatBench(o: { id?: string; seatHeight: number }): ImplementSpec {
  const { seat, back, thick, gap } = DRAWN_BENCH
  return {
    id: o.id ?? 'bench',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      { shape: 'box', center: [0, -thick / 2, seat.len / 2], size: [seat.width, thick, seat.len], pad: true },
      { shape: 'box', center: [0, -thick / 2, -gap - back.len / 2], size: [back.width, thick, back.len], rot: [0, 0, 0, 1], pad: true },
    ],
    sites: {},
  }
}

/**
 * The same flat bench standing across the lifter (wrist curls): kind cross_bench, so the composer leaves it to the
 * family layout (props/families/arms/bench.ts), which draws the adjustable bench, flat, at the implement's pose.
 */
export function crossBench(o: { id?: string; seatHeight: number }): ImplementSpec {
  return { ...drawnFlatBench({ id: o.id ?? 'xbench', seatHeight: o.seatHeight }), kind: 'cross_bench' }
}

/** angled pushdown V-bar: hub `hub` m below the carabiner, handles `len` long sloping `slope` deg below horizontal from `inner` m either side */
export const PUSHDOWN_V = { hub: 0.07, inner: 0.08, len: 0.12, slope: 12, r: 0.015 }

/**
 * The angled V-bar for pushdowns (wave 3c): a cable attachment (kind cable_handle, drawn by props/cable.ts as the
 * v_bar with sloping handles) whose two handles run down and out from a hub under the stem, so the hands hold it
 * thumbs up, palms angled in. Sites `l` / `r` at the handle middles, axis little finger to index for a hand closing
 * from outside: up the handle towards the hub (left hand on +X).
 */
export function pushdownV(id = 'handle'): ImplementSpec {
  const { hub, inner, len, slope, r } = PUSHDOWN_V
  const s = (slope * Math.PI) / 180
  const d: V3 = [Math.cos(s), -Math.sin(s), 0]
  const end = (x: number, t: number): V3 => [x * (inner + d[0] * t), -hub + d[1] * t, 0]
  return {
    ...cableHandle({ id, attachment: 'v_bar' }),
    com: [0, -hub, 0],
    parts: [cyl([0, 0, 0], [0, -hub, 0], 0.012), cyl(end(1, 0), end(1, len), r), cyl(end(-1, 0), end(-1, len), r)],
    sites: {
      l: { pos: end(1, len / 2), axis: [-d[0], -d[1], 0] },
      r: { pos: end(-1, len / 2), axis: [d[0], -d[1], 0] },
    },
  }
}

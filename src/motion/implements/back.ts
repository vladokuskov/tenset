import type { ImplementSpec, Part } from '../implements.ts'
import { qaxis, type V3 } from '../math.ts'

// F4 back: implement factories (ImplementSpec geometry) for this family's templates. New implement kinds go in
// KINDS, and kinds that move with the hands in MOVING (the equipment-equipment check tests those against everything).
// The figure props (src/features/figure/props/families/back/) draw them at exactly these dimensions.

export const KINDS = ['row_station', 'row_rope_end', 'row_rope_strand', 'row_rack'] as const
export const MOVING: readonly string[] = ['row_rope_end']

/**
 * Seated cable row station: a long padded seat on a floor rail, two angled foot plates either side of a low pulley
 * and a compact weight-stack tower in front. Frame: X across, Y up, the lifter faces +Z.
 */
export const ROW_STATION = {
  seat: { width: 0.32, thick: 0.07, length: 0.9 },
  /** foot plate: width (X), height along the plate, thickness of the padded face */
  plate: { width: 0.17, height: 0.3, face: 0.02, back: 0.012 },
  /** low pulley wheel centre below the plates' centre line (between the feet), m */
  pulleyDrop: 0.08,
  /** tower in front of the foot plates: distance from the plate centres to the stack axis, m */
  towerZ: 0.5,
  towerHeight: 1.75,
  railY: 0.035,
}

export type RowStationGeometry = {
  /** seat top height and its z extent (rear, front) */
  seatTop: number
  seatZ: [number, number]
  /** foot plate centres (on the padded face surface) and their tilt from horizontal, deg (the face looks back and up) */
  plates: V3[]
  plateAngle: number
  /** low pulley wheel centre */
  pulley: V3
}

const box = (center: V3, size: V3, pad = false, rot?: [number, number, number, number]): Part => ({ shape: 'box', center, size, ...(rot ? { rot } : {}), ...(pad ? { pad: true } : {}) })

/** plate box orientation: local Y is the face normal, local Z runs up the plate */
export function plateRotation(angle: number): [number, number, number, number] {
  return qaxis([1, 0, 0], (-angle * Math.PI) / 180) as [number, number, number, number]
}

/** plate face normal for a tilt from horizontal (looks back towards the lifter, -Z, and up) */
export function plateNormal(angle: number): V3 {
  const a = (angle * Math.PI) / 180
  return [0, Math.cos(a), -Math.sin(a)]
}

/** the contact geometry of the station: seat pad, foot plates (padded faces and their rigid backs), the low pulley housing */
export function rowStation(g: RowStationGeometry, id = 'row_seat'): ImplementSpec {
  const { seat, plate } = ROW_STATION
  const rot = plateRotation(g.plateAngle)
  const n = plateNormal(g.plateAngle)
  const parts: Part[] = [box([0, g.seatTop - seat.thick / 2, (g.seatZ[0] + g.seatZ[1]) / 2], [seat.width, seat.thick, g.seatZ[1] - g.seatZ[0]], true)]
  for (const c of g.plates) {
    const face: V3 = [c[0] - n[0] * (plate.face / 2), c[1] - n[1] * (plate.face / 2), c[2] - n[2] * (plate.face / 2)]
    const back: V3 = [c[0] - n[0] * (plate.face + plate.back / 2), c[1] - n[1] * (plate.face + plate.back / 2), c[2] - n[2] * (plate.face + plate.back / 2)]
    parts.push(box(face, [plate.width, plate.face, plate.height], true, rot), box(back, [plate.width, plate.back, plate.height], false, rot))
  }
  return {
    id,
    kind: 'row_station',
    mass: 0,
    com: [0, 0, 0],
    parts,
    sites: {
      seat: { pos: [0, g.seatTop, (g.seatZ[0] + g.seatZ[1]) / 2], normal: [0, 1, 0] },
      plate_l: { pos: g.plates[0], normal: n },
      plate_r: { pos: g.plates[1], normal: n },
      pulley: { pos: g.pulley },
    },
  }
}

/**
 * Half rack for work under a racked bar (inverted row): only a marker for the drawn rack (props/rack.ts) and where
 * the bar rests. The bar axis sits RACK_REST.z in front of the front uprights (the J-hook cradle, post / 2 + 0.055).
 */
export const RACK_REST = { z: 0.0925 }

export function rack(o: { id?: string; hookHeight: number; safetyHeight?: number }): ImplementSpec {
  return {
    id: o.id ?? 'rack',
    kind: 'row_rack',
    mass: 0,
    com: [0, 0, 0],
    parts: [],
    // spotter arms low, out of the way of the body at the bottom of the rep
    sites: { bar: { pos: [0, o.hookHeight, RACK_REST.z] }, safety: { pos: [0, o.safetyHeight ?? 0.25, 0] } },
  }
}

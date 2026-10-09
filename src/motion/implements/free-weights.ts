import { PLATE_20_RADIUS, type ImplementSpec, type Part } from '../implements.ts'
import { norm, sub, type V3 } from '../math.ts'

// Free weights held in the hands: kettlebell, a single weight plate and the trap (hex) bar
// (docs/FAMILIES.md "Free weights"). The figure props (src/features/figure/props/free-weights.ts) draw them from these
// descriptors, so contact surfaces and grip sites match the drawn shapes.

export const KINDS = ['kettlebell', 'weight_plate', 'trap_bar'] as const
export const MOVING: readonly string[] = ['kettlebell', 'weight_plate', 'trap_bar']

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

// ---------- kettlebell ----------

export const KETTLEBELL_KG = [12, 16, 20, 24, 28, 32] as const

/**
 * Cast-iron kettlebell dimensions for a mass (kg): bell radius R (centre at the origin), flat base at -base, handle
 * tube radius, the top bar's centre height, the horns' x where they leave the bell and at the top corners.
 */
export function kettlebellDims(kg: number) {
  const R = 0.5 * (0.15 + 0.0025 * kg)
  const base = 0.86 * R
  const handleR = 0.0165 + 0.00008 * kg
  const height = 0.25 + 0.0025 * kg
  const top = height - base - handleR
  const hornX = 0.085 + 0.0006 * kg
  const bend = 0.032
  return { R, base, handleR, height, top, hornX, hornBaseX: 0.55 * R, hornBaseY: 0.78 * R, bend }
}

/** bell slabs (cylinders along Y) approximating the sphere for the gates: boundaries as fractions of R */
const BELL_SLABS = [-0.86, -0.6, -0.3, 0.3, 0.6, 0.82, 0.97]

/**
 * Kettlebell, 12-32 kg. Local frame: bell centre at the origin, +Y up through the handle, the handle in the XY plane
 * (window facing +-Z). Sites (grip axes little finger to index, left hand on +X):
 * - `handle`: top bar centre, axis X (one hand: suitcase carry, hang, row, swing with one hand)
 * - `handle_l`, `handle_r`: the two halves of the top bar, axis X (two-hand hold or swing)
 * - `horn_l`, `horn_r`: middle of each horn, axis up the horn (goblet on the horns, palms facing in)
 * - `corner_l`, `corner_r`: the top corners, axis along the bend (front rack: handle diagonal in the palm)
 * - `window`: centre of the handle window, normal +Z (the forearm passes here in the front rack)
 * - `base`: centre of the flat base, normal -Y (standing on the floor: pose y = dims.base)
 */
export function kettlebell(o: { id?: string; kg?: number } = {}): ImplementSpec {
  const kg = o.kg ?? 16
  const d = kettlebellDims(kg)
  const { R, top, hornX, hornBaseX, hornBaseY, bend, handleR: r } = d
  const parts: Part[] = []
  for (let k = 0; k + 1 < BELL_SLABS.length; k++) {
    const y0 = BELL_SLABS[k] * R, y1 = BELL_SLABS[k + 1] * R
    const ym = y0 < 0 && y1 > 0 ? 0.15 * R : (Math.abs(y0) + Math.abs(y1)) / 2
    parts.push(cyl([0, y0, 0], [0, y1, 0], Math.sqrt(R * R - ym * ym)))
  }
  const sites: ImplementSpec['sites'] = {}
  for (const [s, side] of [[1, 'l'], [-1, 'r']] as const) {
    const foot: V3 = [s * hornBaseX, hornBaseY, 0]
    const corner: V3 = [s * hornX, top - bend, 0]
    const inner: V3 = [s * (hornX - bend), top, 0]
    parts.push(cyl(foot, corner, r), cyl(corner, inner, r))
    sites[`horn_${side}`] = { pos: [(foot[0] + corner[0]) / 2, (foot[1] + corner[1]) / 2, 0], axis: norm(sub(corner, foot)) }
    sites[`corner_${side}`] = { pos: [(corner[0] + inner[0]) / 2, (corner[1] + inner[1]) / 2, 0], axis: norm(sub(inner, corner)) }
  }
  parts.push(cyl([hornX - bend, top, 0], [-(hornX - bend), top, 0], r))
  Object.assign(sites, {
    handle: { pos: [0, top, 0], axis: [1, 0, 0] },
    handle_l: { pos: [0.045, top, 0], axis: [1, 0, 0] },
    handle_r: { pos: [-0.045, top, 0], axis: [1, 0, 0] },
    window: { pos: [0, (R + top - r) / 2, 0], normal: [0, 0, 1] },
    base: { pos: [0, -d.base, 0], normal: [0, -1, 0] },
  })
  return { id: o.id ?? 'kettlebell', kind: 'kettlebell', mass: kg, com: [0, 0, 0], parts, sites }
}

// ---------- weight plate ----------

/** iron plates as on the barbell (implements.ts barbell): radius and thickness per size */
export const PLATE = {
  20: { r: PLATE_20_RADIUS, w: 0.05 },
  10: { r: 0.16, w: 0.035 },
  5: { r: 0.115, w: 0.035 },
} as const
export type PlateKg = keyof typeof PLATE

/** rim segments: the rim is a ring of thin cylinders, so a hand gripping it is a hand on a handle for the gates */
export const PLATE_RIM_SEGMENTS = 16

/**
 * A weight plate held in the hands. Local frame: centre at the origin, faces normal to Z (z from -w/2 to w/2). Parts: a
 * core disc (radius r - w) and a ring of rim cylinders of radius w/2, so the gates treat the rim as a handle under a
 * gripping hand. Sites (left hand on +X):
 * - `rim_l`, `rim_r`: rim at 3 and 9 o'clock seen from +Z, axis +Y (two hands on the sides: front raise, Russian twist)
 * - `rim_top`, `rim_bottom`: 12 and 6 o'clock, axis X
 * - `front`, `back`: face centres, normals +Z and -Z (held to the chest: `back` on the sternum)
 * - `palm_l`, `palm_r`: on the front face 7 cm either side of the centre, normal +Z (flat hands holding it to the chest)
 */
export function weightPlate(o: { id?: string; kg?: PlateKg } = {}): ImplementSpec {
  const kg = o.kg ?? 10
  const { r: R, w } = PLATE[kg]
  const h = w / 2, rc = R - h
  const parts: Part[] = [cyl([0, 0, -h], [0, 0, h], R - w)]
  const n = PLATE_RIM_SEGMENTS
  // tangent segments whose ends meet on the rim centre circle
  const half = rc * Math.tan(Math.PI / n)
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n
    const c: V3 = [rc * Math.cos(a), rc * Math.sin(a), 0]
    const t: V3 = [-Math.sin(a), Math.cos(a), 0]
    parts.push(cyl([c[0] - t[0] * half, c[1] - t[1] * half, 0], [c[0] + t[0] * half, c[1] + t[1] * half, 0], h))
  }
  return {
    id: o.id ?? 'plate',
    kind: 'weight_plate',
    mass: kg,
    com: [0, 0, 0],
    parts,
    sites: {
      rim_l: { pos: [rc, 0, 0], axis: [0, 1, 0] },
      rim_r: { pos: [-rc, 0, 0], axis: [0, 1, 0] },
      rim_top: { pos: [0, rc, 0], axis: [1, 0, 0] },
      rim_bottom: { pos: [0, -rc, 0], axis: [1, 0, 0] },
      front: { pos: [0, 0, h], normal: [0, 0, 1] },
      back: { pos: [0, 0, -h], normal: [0, 0, -1] },
      palm_l: { pos: [0.07, 0, h], normal: [0, 0, 1] },
      palm_r: { pos: [-0.07, 0, h], normal: [0, 0, 1] },
    },
  }
}

// ---------- trap bar ----------

/**
 * Open hexagon trap bar (m, kg). The hexagon lies in the sleeve plane (y = 0): side vertices at x = +-hex.a where the
 * sleeves start, front and rear edges at z = +-hex.c running between x = +-hex.b. The handles run front to back
 * inside it at x = +-handleX, offset `rise` above the sleeve axis (high handles) or below it (the bar flipped: low
 * handles), on risers welded to the slanted edges.
 */
export const TRAP_BAR = {
  hex: { a: 0.5, b: 0.25, c: 0.29 },
  frameR: 0.017,
  handleX: 0.315,
  handleR: 0.0165,
  /** knurled half length of each handle */
  grip: 0.12,
  rise: 0.035,
  collar: { from: 0.5, to: 0.525, r: 0.04 },
  sleeve: { to: 0.8, r: 0.025 },
  mass: 25,
}

/** z of the slanted hexagon edges at x (|x| between hex.b and hex.a) */
export const trapEdgeZ = (x: number) => (TRAP_BAR.hex.c * (TRAP_BAR.hex.a - Math.abs(x))) / (TRAP_BAR.hex.a - TRAP_BAR.hex.b)

/** plates from x0 outwards along the sleeve (+X side; mirrored by the caller), 20 / 10 / 5 kg as on the barbell */
export function plateStack(kg: number, x0: number): { r: number; from: number; to: number }[] {
  const out: { r: number; from: number; to: number }[] = []
  let x = x0
  for (let left = kg; left > 0; ) {
    const p: PlateKg = left >= 20 ? 20 : left >= 10 ? 10 : 5
    out.push({ r: PLATE[p].r, from: x, to: x + PLATE[p].w })
    x += PLATE[p].w + 0.003
    left -= p
  }
  return out
}

/**
 * Trap (hex) bar. Local frame: centre of the hexagon on the sleeve axis, lifter standing inside facing +Z, left hand on
 * +X. `handles: 'high'` (default) puts the grips `rise` above the sleeve axis, 'low' below it. With 20 kg plates on
 * the floor the sleeve axis is at PLATE[20].r. Sites `l`, `r`: handle centres, axis +Z (neutral grip, palms in).
 */
export function trapBar(o: { id?: string; plateKg?: number; handles?: 'high' | 'low' } = {}): ImplementSpec {
  const plate = o.plateKg ?? 40
  const { hex, frameR, handleX, handleR, rise, collar, sleeve } = TRAP_BAR
  const y = o.handles === 'low' ? -rise : rise
  const ze = trapEdgeZ(handleX)
  const parts: Part[] = [
    cyl([hex.b, 0, hex.c], [-hex.b, 0, hex.c], frameR),
    cyl([hex.b, 0, -hex.c], [-hex.b, 0, -hex.c], frameR),
  ]
  for (const s of [1, -1]) {
    parts.push(cyl([s * hex.a, 0, 0], [s * hex.b, 0, hex.c], frameR), cyl([s * hex.a, 0, 0], [s * hex.b, 0, -hex.c], frameR))
    parts.push(cyl([s * handleX, y, -ze], [s * handleX, y, ze], handleR))
    for (const z of [ze, -ze]) parts.push(cyl([s * handleX, 0, z], [s * handleX, y, z], frameR))
    parts.push(cyl([s * collar.from, 0, 0], [s * collar.to, 0, 0], collar.r), cyl([s * collar.to, 0, 0], [s * sleeve.to, 0, 0], sleeve.r))
    for (const p of plateStack(plate, collar.to + 0.01)) parts.push(cyl([s * p.from, 0, 0], [s * p.to, 0, 0], p.r))
  }
  return {
    id: o.id ?? 'bar',
    kind: 'trap_bar',
    mass: TRAP_BAR.mass + 2 * plate,
    com: [0, 0, 0],
    parts,
    sites: { l: { pos: [handleX, y, 0], axis: [0, 0, 1] }, r: { pos: [-handleX, y, 0], axis: [0, 0, 1] } },
  }
}

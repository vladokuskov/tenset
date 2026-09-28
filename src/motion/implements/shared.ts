import { bench, type ImplementSpec, type Part } from '../implements.ts'
import type { V3 } from '../math.ts'

// Supports several families share: plyo box / step, floor mat, wall section (local origin on the floor) and the flat
// bench. The figure props (src/features/figure/props/shared.ts) draw them at exactly these dimensions.

export const KINDS = ['plyo_box', 'mat', 'wall'] as const
export const MOVING: readonly string[] = []

/** rubber tread on top of a box: a padded surface (feet may sink a little), the body under it is rigid */
export const TREAD = 0.012

export const PLYO_BOX = { heights: [0.2, 0.3, 0.45] as const, width: 0.6, depth: 0.45 }

/** Plyo box / step: footprint centred on the origin, +Z is the front. Sites: top centre, front and rear top edges
 * (axis along the edge, for the ball of the foot or the hands). */
export function plyoBox(o: { id?: string; height: number; width?: number; depth?: number }): ImplementSpec {
  const h = o.height, w = o.width ?? PLYO_BOX.width, d = o.depth ?? PLYO_BOX.depth
  const parts: Part[] = [
    { shape: 'box', center: [0, (h - TREAD) / 2, 0], size: [w, h - TREAD, d] },
    { shape: 'box', center: [0, h - TREAD / 2, 0], size: [w, TREAD, d], pad: true },
  ]
  const up: V3 = [0, 1, 0]
  return {
    id: o.id ?? 'box',
    kind: 'plyo_box',
    mass: 0,
    com: [0, 0, 0],
    parts,
    sites: {
      top: { pos: [0, h, 0], normal: up },
      front: { pos: [0, h, d / 2], axis: [1, 0, 0], normal: up },
      back: { pos: [0, h, -d / 2], axis: [1, 0, 0], normal: up },
    },
  }
}

export const FLOOR_MAT = { length: 1.8, width: 0.6, thick: 0.01 }

/** Floor exercise mat, length along Z. Site: top centre. */
export function floorMat(o: { id?: string; length?: number; width?: number } = {}): ImplementSpec {
  const L = o.length ?? FLOOR_MAT.length, W = o.width ?? FLOOR_MAT.width, T = FLOOR_MAT.thick
  return {
    id: o.id ?? 'mat',
    kind: 'mat',
    mass: 0,
    com: [0, 0, 0],
    parts: [{ shape: 'box', center: [0, T / 2, 0], size: [W, T, L], pad: true }],
    sites: { top: { pos: [0, T, 0], normal: [0, 1, 0] } },
  }
}

export const WALL = { width: 1.0, height: 2.1, thick: 0.1 }
/** skirting board along the foot of the face (m) */
export const SKIRTING = { depth: 0.01, height: 0.08 }

/** Wall section: the face lies in the plane z = 0 facing +Z, where the lifter stands, with a skirting board. Site:
 * face centre at 1 m. */
export function wallSection(o: { id?: string; width?: number; height?: number } = {}): ImplementSpec {
  const W = o.width ?? WALL.width, H = o.height ?? WALL.height, D = WALL.thick
  return {
    id: o.id ?? 'wall',
    kind: 'wall',
    mass: 0,
    com: [0, 0, 0],
    parts: [{ shape: 'box', center: [0, H / 2, -D / 2], size: [W, H, D] }, { shape: 'box', center: [0, SKIRTING.height / 2, SKIRTING.depth / 2], size: [W, SKIRTING.height, SKIRTING.depth] }],
    sites: { face: { pos: [0, 1, 0], normal: [0, 0, 1] } },
  }
}

/** flat bench: the adjustable bench with the back pad down (the composer draws it as the adjustable bench, flat) */
export function flatBench(o: { id?: string; seatHeight?: number } = {}): ImplementSpec {
  return bench({ id: o.id, seatHeight: o.seatHeight, backAngle: 0 })
}

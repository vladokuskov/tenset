import { cableHandle, type ImplementSpec, type Part } from '../implements.ts'
import type { V3 } from '../math.ts'

// F9 core: implement factories (ImplementSpec geometry) for this family's templates. New implement kinds go in
// KINDS, and kinds that move with the hands in MOVING (the equipment-equipment check tests those against everything).
export const KINDS = ['palm_rest'] as const
export const MOVING: readonly string[] = []

/**
 * partless markers where a hand rests (flat on the mat, on the hip): grip contacts, so the scene can give the hand a
 * posed shape. Sites in the implement frame; pose it at the origin for fixed rests or with the body for moving ones.
 */
export function palmRest(o: { id?: string; sites: Record<string, V3> }): ImplementSpec {
  return { id: o.id ?? 'palms', kind: 'palm_rest', mass: 0, com: [0, 0, 0], parts: [], sites: Object.fromEntries(Object.entries(o.sites).map(([k, pos]) => [k, { pos }])) }
}

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

/** cable rope with its grips `half` m either side of the midline, `drop` m below the carabiner (local -Y) */
export function coreRope(o: { id?: string; half: number; drop: number }): ImplementSpec {
  const base = cableHandle({ id: o.id ?? 'handle', attachment: 'rope' })
  const k = 1 / 0.85
  const end = (s: number): V3 => [s * o.half * k, -o.drop * k, 0]
  const axis = (s: number): V3 => {
    const l = Math.hypot(o.half, o.drop)
    return [(s * o.half) / l, -o.drop / l, 0]
  }
  return {
    ...base,
    parts: [cyl([0, 0, 0], end(1), 0.012), cyl([0, 0, 0], end(-1), 0.012)],
    sites: { l: { pos: [o.half, -o.drop, 0], axis: axis(1) }, r: { pos: [-o.half, -o.drop, 0], axis: axis(-1) } },
  }
}

/** D-handle with a grip bar long enough for two hands side by side (sites l and r, `gap` m apart along local X) */
export function twoHandHandle(o: { id?: string; gap: number }): ImplementSpec {
  const base = cableHandle({ id: o.id ?? 'handle', attachment: 'single_handle' })
  const half = o.gap / 2 + 0.065
  const y = -0.11
  return {
    ...base,
    parts: [cyl([0, 0, 0], [half - 0.01, y + 0.01, 0], 0.006), cyl([0, 0, 0], [-half + 0.01, y + 0.01, 0], 0.006), cyl([-half, y, 0], [half, y, 0], 0.016)],
    sites: { l: { pos: [o.gap / 2, y, 0], axis: [1, 0, 0] }, r: { pos: [-o.gap / 2, y, 0], axis: [1, 0, 0] } },
  }
}

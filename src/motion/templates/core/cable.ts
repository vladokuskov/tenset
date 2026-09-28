import type { ImplementSpec } from '../../implements.ts'
import { add, scale, type V3 } from '../../math.ts'

// Cable stacks for the F9 core templates: the column stands 0.12 m beyond the pulley (props/cable.ts CABLE_STACK
// pulleyZ), on the far side from the lifter; the composer draws the stack facing the lifter from these two parts.

export const PULLEY = { low: 0.1, mid: 1.0, high: 2.0 } as const

/** column 0.12 m from the pulley along the horizontal unit `away` (pointing from the lifter to the stack) */
export function stackSpec(pulley: V3, away: V3 = [0, 0, 1]): ImplementSpec {
  const col = add([pulley[0], 0, pulley[2]], scale(away, 0.12))
  return {
    id: 'stack',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      { shape: 'cylinder', a: col, b: [col[0], 2.1, col[2]], r: 0.05 },
      { shape: 'cylinder', a: pulley, b: [col[0], pulley[1], col[2]], r: 0.04 },
    ],
    sites: {},
  }
}

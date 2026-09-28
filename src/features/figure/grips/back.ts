import type { GripDef } from './types.ts'

// F4 back: extra hand shapes for hands.ts. Names are global, so they must not clash with other families'.
export const GRIPS = {
  // supporting hand flat on a bench pad (one-arm row): fingers together and just off straight so the tips meet the
  // pad, thumb out beside the index
  'bench-palm': { diameter: 0.033, posed: { mcp: [1, 1, 2, 3], pip: [3, 3, 3, 3], dip: [2, 2, 2, 2], spread: 0.3, thumb: { bone: 'finger2-1', at: 0.15, radial: 0.035, palmar: 0.004 } } },
} satisfies Record<string, GripDef>

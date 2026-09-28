import type { GripDef } from './types.ts'

// F9 core: extra hand shapes for hands.ts. Names are global, so they must not clash with other families'.
export const GRIPS = {
  // a loose fist resting on its little-finger edge (forearm planks): fingers curled, the thumb over the index
  'loose-fist': { diameter: 0.033, posed: { mcp: [62, 68, 74, 80], pip: [82, 86, 88, 88], dip: [30, 34, 34, 32], spread: 0.3, thumb: { bone: 'finger2-2', at: 0.45, radial: 0.006, palmar: 0.016 } } },
  // hand resting on the hip (side plank): fingers together and gently curled over the pelvis, thumb spread back
  'hip-rest': { diameter: 0.033, posed: { mcp: [10, 12, 14, 16], pip: [14, 16, 18, 20], dip: [6, 6, 6, 6], spread: 0.3, thumb: { bone: 'finger2-1', at: 0.1, radial: 0.035, palmar: -0.004 } } },
} satisfies Record<string, GripDef>

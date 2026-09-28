import type { GripDef } from './types.ts'

// F6 legs-hip-calf: extra hand shapes for hands.ts. Names are global, so they must not clash with other families'.
export const GRIPS = {
  // a light hand on a wall for balance: fingertips and thumb on the wall, palm off it, fingers loosely curled
  'wall-touch': { diameter: 0.033, posed: { mcp: [26, 28, 30, 30], pip: [34, 36, 38, 38], dip: [14, 14, 14, 12], spread: 0.55, thumb: { bone: 'finger2-1', at: 0.2, radial: 0.018, palmar: 0.012 } } },
} satisfies Record<string, GripDef>

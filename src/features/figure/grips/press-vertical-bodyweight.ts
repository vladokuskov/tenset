import type { GripDef } from './types.ts'

// F2 press-vertical-bodyweight: extra hand shapes for hands.ts. Names are global, so they must not clash with other families'.
export const GRIPS = {
  // push-up palm: flat on the floor, fingers straight and spread for support, thumb out in the palm plane
  'push-up-palm': { diameter: 0.033, posed: { mcp: [-4, -3, -3, -4], pip: [2, 2, 2, 2], dip: [1, 1, 1, 1], spread: 0.85, thumb: { bone: 'finger2-1', at: 0.2, radial: 0.03, palmar: 0.002 } } },
} satisfies Record<string, GripDef>

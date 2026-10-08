import type { GripDef } from './types.ts'

// F7 hinge: extra hand shapes for hands.ts. Names are global, so they must not clash with other families'.
export const GRIPS = {
  // dumbbell hip thrust: palm on the dumbbell's end face, fingers curled over the rim of the head
  'end-cup': { diameter: 0.033, posed: { mcp: [34, 36, 38, 38], pip: [44, 46, 48, 48], dip: [18, 18, 18, 16], spread: 0.45, thumb: { bone: 'finger2-1', at: 0.25, radial: 0.02, palmar: 0.01 } } },
} satisfies Record<string, GripDef>

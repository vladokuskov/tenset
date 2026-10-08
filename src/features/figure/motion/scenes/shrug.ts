import type { SceneSpec } from './types.ts'

export const shrug: SceneSpec = {
  // rear three-quarter turned further to the side than the default: the traps read from behind while the shoulders'
  // straight-up path shows against the neck, and the hands on a bar in front of the thighs stay in view
  camera: (params) => {
    // Smith: from nearly behind, so the view runs between the uprights onto the traps (as the Smith squat)
    if (params.implement === 'smith') return { az: -165, elev: 0.32 }
    return { az: -140, elev: 0.34 }
  },
}

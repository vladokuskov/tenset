import type { SceneSpec } from './types.ts'

export const shrug: SceneSpec = {
  // rear three-quarter turned further to the side than the default: the traps read from behind while the shoulders'
  // straight-up path shows against the neck, and the hands on a bar in front of the thighs stay in view
  camera: (params) => {
    // Smith: from nearly behind, so the view runs between the uprights onto the traps (as the Smith squat)
    if (params.implement === 'smith') return { az: -165, elev: 0.32 }
    // cable upright row: from the front-right side, past the column, so the bar rising up the body, the elbows leading
    // out and up and the side delts read (from behind the bar and hands hide behind the trunk)
    if (params.movement === 'upright_row') return { az: -62, elev: 0.22 }
    return { az: -140, elev: 0.34 }
  },
}

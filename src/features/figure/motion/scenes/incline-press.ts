import type { SceneSpec } from './types.ts'

export const inclinePress: SceneSpec = {
  camera: (params) => {
    // from past the feet on the lifter's right, raised: the upper chest and both arms read between the plates (from
    // the side the near plate hides the near arm at the bottom); the Smith lower, so its rails frame the lifter
    if (params.implement === 'smith') return { az: -30, elev: 0.4 }
    return { az: -35, elev: 0.5 }
  },
}

import type { SceneSpec } from './types.ts'

export const inclinePress: SceneSpec = {
  camera: (params) => {
    // from past the feet on the lifter's right, raised: the upper chest and both arms read between the plates (from
    // the side the near plate hides the near arm at the bottom); the Smith lower, so its rails frame the lifter
    if (params.implement === 'smith') return { az: -30, elev: 0.4 }
    // seated incline machine: nearer the side, so the press up and forward reads and the near lever passes below the
    // chest instead of across it
    if (params.implement === 'machine') return { az: -72, elev: 0.55 }
    // landmine: nearer the side, so the press up and forward along the bar reads past the chest and the bar runs
    // away to its pivot instead of towards the camera
    if (params.implement === 'landmine') return { az: -75, elev: 0.25 }
    return { az: -35, elev: 0.5 }
  },
}

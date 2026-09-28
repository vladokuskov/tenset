import type { SceneSpec } from './types.ts'

export const fly: SceneSpec = {
  camera: (params) => {
    // lying: from past the feet on the lifter's right and raised, as the lying presses, so the chest and both arms'
    // arcs read beside the bench
    if (params.posture === 'lying_supine') return { az: -30, elev: 0.55 }
    return { az: -35, elev: 0.3 }
  },
}

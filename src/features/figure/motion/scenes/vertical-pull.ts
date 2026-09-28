import type { SceneSpec } from './types.ts'

export const verticalPull: SceneSpec = {
  camera: (params) => {
    // seated: turned further to the side so the stack tower behind the lifter stays clear of the back; neutral
    // handles run front to back, so they read from further round
    if (params.posture === 'seated') return { az: -118, elev: 0.22 }
    return params.grip === 'neutral' ? { az: -125, elev: 0.34 } : { az: -145, elev: 0.16 }
  },
}

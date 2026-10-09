import type { SceneSpec } from './types.ts'

export const curl: SceneSpec = {
  camera: (params) => {
    // high cable curl: the double-biceps pose between two towers reads face on, from a little to the right
    if (params.armPosition === 'abducted') return { az: -20, elev: 0.2 }
    // cable: the stack stands in front of the lifter, so from -35 its upright hides the left hand; -60 sees past it
    return params.implement === 'cable' ? { az: -60, elev: 0.3 } : { az: -35, elev: 0.3 }
  },
}

import type { SceneSpec } from './types.ts'

export const externalRotation: SceneSpec = {
  camera: (params) => {
    // side-lying: the lifter faces +X with the head towards -Z, so this is behind it towards the feet and high, where
    // the back of the working shoulder and the forearm rising towards the ceiling both read
    if (params.posture === 'side_lying') return { az: -60, elev: 0.62 }
    return { az: -145, elev: 0.24 }
  },
}

import type { SceneSpec } from './types.ts'

export const rollout: SceneSpec = {
  camera: (params) => {
    // oblique: from the front, high and on the far side from the diagonal, so the wheel's path runs across the frame
    // instead of towards the camera
    if (params.direction === 'oblique') return { az: params.side === 'left' ? -45 : 45, elev: 0.42 }
    // from the side and a little in front: the trunk and arms extend along the floor, so a three-quarter view from the
    // front would foreshorten the whole rollout
    return { az: -75, elev: 0.28 }
  },
}

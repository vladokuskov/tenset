import type { SceneSpec } from './types.ts'

export const swing: SceneSpec = {
  // side on and a little behind: the hinge, the hip snap and the bell's arc from behind the legs to chest height read
  // in profile while the glutes still face the camera
  camera: () => ({ az: -105, elev: 0.2 }),
}

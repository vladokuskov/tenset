import type { SceneSpec } from './types.ts'

export const rotation: SceneSpec = {
  // front three-quarter from the working side: the obliques and the diagonal handle path read, the stack stands clear
  camera: () => ({ az: -30, elev: 0.26 }),
}

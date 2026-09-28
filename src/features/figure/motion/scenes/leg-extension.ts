import type { SceneSpec } from './types.ts'

// front three-quarter turned towards the side: the quads read and the shin's arc and the lever stay in profile
export const legExtension: SceneSpec = {
  camera: () => ({ az: -60, elev: 0.24 }),
}

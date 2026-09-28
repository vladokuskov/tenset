import type { SceneSpec } from './types.ts'

export const curl: SceneSpec = {
  // cable: the stack stands in front of the lifter, so from -35 its upright hides the left hand; -60 sees past it
  camera: (params) => (params.implement === 'cable' ? { az: -60, elev: 0.3 } : { az: -35, elev: 0.3 }),
}

import type { SceneSpec } from './types.ts'

export const lunge: SceneSpec = {
  // front three-quarter turned well towards the side: the split stance, the front knee over the toes, the rear knee's
  // drop and the working quad and glute read in profile; bench and box stay clear of the legs
  camera: (params) => (params.direction === 'step_up' ? { az: -62, elev: 0.24 } : { az: -66, elev: 0.22 }),
  // the loop shows the right leg leading, so alternating lunges pulse the right side as unilateral ones do
  highlight: (base, ex) => (ex.laterality === 'alternating' ? { ...base, side: 'r' } : base),
}

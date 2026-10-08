import type { SceneSpec } from './types.ts'

export const lunge: SceneSpec = {
  // rear three-quarter turned towards the side, as the approved squats: the working glute (tinted shorts) and quad both
  // read, the front knee over the toes and the rear knee's drop stay in profile; bench and box stay clear of the legs
  // Smith: front three-quarter, so the view runs between the uprights and the near plate stays clear of the trunk
  camera: (params) => (params.implement === 'smith' ? { az: -65, elev: 0.24 } : { az: -115, elev: 0.24 }),
  // the loop shows the right leg leading, so alternating lunges pulse the right side as unilateral ones do
  highlight: (base, ex) => (ex.laterality === 'alternating' ? { ...base, side: 'r' } : base),
}

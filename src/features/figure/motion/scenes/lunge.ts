import type { SceneSpec } from './types.ts'

export const lunge: SceneSpec = {
  // rear three-quarter turned towards the side, as the approved squats: the working glute (tinted shorts) and quad both
  // read, the front knee over the toes and the rear knee's drop stay in profile; bench and box stay clear of the legs
  camera: () => ({ az: -115, elev: 0.24 }),
  // the loop shows the right leg leading, so alternating lunges pulse the right side as unilateral ones do
  highlight: (base, ex) => (ex.laterality === 'alternating' ? { ...base, side: 'r' } : base),
}

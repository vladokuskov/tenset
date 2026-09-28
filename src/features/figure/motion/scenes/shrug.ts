import type { SceneSpec } from './types.ts'

export const shrug: SceneSpec = {
  // rear three-quarter turned further to the side than the default: the traps read from behind while the shoulders'
  // straight-up path shows against the neck, and the hands on a bar in front of the thighs stay in view
  camera: () => ({ az: -140, elev: 0.34 }),
}

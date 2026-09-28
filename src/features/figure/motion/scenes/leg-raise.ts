import type { SceneSpec } from './types.ts'

export const legRaise: SceneSpec = {
  // hanging: the legs rise towards the camera, so it stands round to the side where the hip flexion reads past the
  // uprights; lying: high on the foot side like the floor crunch
  camera: (params) => (params.posture === 'hanging' ? { az: -58, elev: 0.18 } : { az: -58, elev: 0.36 }),
  // palms flat on the mat
  grip: (ctx) => (ctx.spec.kind === 'palm_rest' ? 'open' : undefined),
}

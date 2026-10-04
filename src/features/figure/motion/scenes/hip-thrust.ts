import type { SceneSpec } from './types.ts'

export const hipThrust: SceneSpec = {
  // on the mat the hip drive reads from the side. On the bench the glutes face the bench and the floor, and from the
  // side the near plate covers the pelvis (the -60/0.42 view showed only a sliver of the primary): low from the feet
  // end the glutes read under the hips through the bottom half of the rep, the hip drive face on
  camera: (params) => (params.support === 'floor' ? { az: -50, elev: 0.34 } : { az: -30, elev: 0.12 }),
  // palms flat on the mat
  grip: (ctx) => (ctx.spec.kind === 'spot' ? 'open' : undefined),
}

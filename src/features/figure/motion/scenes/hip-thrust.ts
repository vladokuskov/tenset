import type { SceneSpec } from './types.ts'

export const hipThrust: SceneSpec = {
  // on the mat the hip drive reads from the side. On the bench the glutes face the bench and the floor, and from the
  // side the near plate covers the pelvis (the -60/0.42 view showed only a sliver of the primary): low from the feet
  // end the glutes read under the hips through the bottom half of the rep, the hip drive face on
  camera: (params) => {
    if (params.support === 'floor') return { az: -50, elev: 0.34 }
    // bodyweight on the bench (single leg): no plate in the way, so from the working side the hip drive reads and the
    // lifted leg does not fill the frame as it does from the feet end
    if (params.implement === 'bodyweight') return { az: -75, elev: 0.24 }
    // Smith: nearer the feet end and a little higher than the free bar, between the rails, so the uprights and the
    // near plate do not cover the hips and trunk
    if (params.implement === 'smith') return { az: -18, elev: 0.22 }
    return { az: -30, elev: 0.12 }
  },
  // palms flat on the mat; on the dumbbell's end faces
  grip: (ctx) => (ctx.spec.kind === 'spot' ? 'open' : ctx.spec.kind === 'dumbbell' ? 'end-cup' : undefined),
}

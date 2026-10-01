import type { SceneSpec } from './types.ts'

export const hold: SceneSpec = {
  camera: (params) => {
    // front plank: the abs face the floor, so a low view from the side-front shows them and the straight line
    if (params.kind === 'front_plank') return { az: -68, elev: 0.1 }
    // side plank: the body lies across the frame facing the camera, low enough to see the working side's flank
    if (params.kind === 'side_plank') return { az: -22, elev: 0.12 }
    return { az: -35, elev: 0.3 }
  },
  // fists resting on the mat, the side plank's raised hand open
  grip: (ctx) => (ctx.spec.kind === 'palm_rest' ? (ctx.spec.id === 'reach' ? 'open' : 'loose-fist') : undefined),
}

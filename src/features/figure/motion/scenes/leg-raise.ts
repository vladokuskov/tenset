import type { SceneSpec } from './types.ts'

export const legRaise: SceneSpec = {
  // hanging: the legs rise towards the camera, so it stands round to the side where the hip flexion reads past the
  // uprights; lying: high on the foot side like the floor crunch
  camera: (params) => {
    // oblique raise: nearly in front, so the knees' travel towards one shoulder and both flanks read
    if (params.posture === 'hanging' && params.twist) return { az: -14, elev: 0.18 }
    // captain's chair: from the front side, past the near arm pad, where the knees rise above the hips
    if (params.support === 'elbow_pads') return { az: -50, elev: 0.15 }
    return params.posture === 'hanging' ? { az: -58, elev: 0.18 } : { az: -58, elev: 0.36 }
  },
  // palms flat on the mat
  // palms flat on the mat; the captain's chair's upright handles in a neutral fist
  grip: (ctx) => (ctx.spec.kind === 'palm_rest' ? 'open' : ctx.spec.kind === 'captains_chair' ? 'neutral' : undefined),
}

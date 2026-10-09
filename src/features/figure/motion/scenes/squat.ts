import type { SceneSpec } from './types.ts'

/** standing squats: behind the right hip, far enough round that the quads read beside the glutes */
const SQUAT_AZ = -128
const FRONT_RACK_AZ = -40

export const squat: SceneSpec = {
  camera: (params) => {
    // leg press from behind the lifter's shoulder: from the side the near plates hide the feet on the sled
    if (params.machine === 'leg_press') return { az: -112, elev: 0.3 }
    // Smith: further behind, so the view runs between the rear uprights instead of through them
    if (params.implement === 'smith') return { az: -163, elev: 0.22 }
    // front rack: front three-quarter, so the bar on the delts and the high elbows read
    if (params.hold === 'front_rack') return { az: FRONT_RACK_AZ, elev: 0.2 }
    // sumo dumbbell: nearly from the front, so the wide turned-out stance and the dumbbell hanging between the legs read
    if (params.hold === 'two_hand') return { az: -18, elev: 0.2 }
    // goblet: nearer the side, or the torso hides the dumbbell and the cupped hands
    return params.hold === 'goblet' ? { az: -115, elev: 0.22 } : { az: SQUAT_AZ, elev: 0.22 }
  },
  // kettlebells: palms in on the horns (goblet) or round the corner (front rack); sumo dumbbell: fingers hooked under the head
  grip: (ctx) => (ctx.spec.kind === 'kettlebell' ? 'neutral' : ctx.site.startsWith('hook_') ? 'hook' : undefined),
}

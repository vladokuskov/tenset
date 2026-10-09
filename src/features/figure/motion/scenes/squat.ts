import type { SceneSpec } from './types.ts'

/** standing squats: behind the right hip, far enough round that the quads read beside the glutes */
const SQUAT_AZ = -128
const FRONT_RACK_AZ = -40

export const squat: SceneSpec = {
  camera: (params) => {
    // leg press from behind the lifter's shoulder: from the side the near plates hide the feet on the sled
    if (params.machine === 'leg_press') return { az: -112, elev: 0.3 }
    // reverse hack: the machine stands in front of the lifter, so from behind the right hip onto the glutes and quads
    if (params.machine === 'hack_squat' && params.reverse) return { az: -125, elev: 0.25 }
    // hack and pendulum: the sled or swing arm sits behind the lifter, so from the front right the quads, the knees
    // travelling forward and the feet on the plate read clear of the rails
    if (params.machine === 'hack_squat' || params.machine === 'pendulum_squat') return { az: -70, elev: 0.2 }
    // Spanish squat: from the front right, so the vertical shins, the hips sitting back and the band from the knees to
    // the post ahead read in profile (from behind the reaching hands sit in front of the post)
    if (params.implement === 'band') return { az: -75, elev: 0.2 }
    // sissy squat: from the right side, so the knees travelling forward and the straight line from the knees to the
    // shoulders read in profile, the post behind the lifter
    if (params.sissy) return { az: -95, elev: 0.15 }
    // box pistol: from the front right, so the leg reaching forward and the box behind both read
    if (params.stance === 'single_leg') return { az: params.side === 'left' ? 60 : -60, elev: 0.22 }
    // Smith: further behind, so the view runs between the rear uprights instead of through them
    if (params.implement === 'smith') return { az: -163, elev: 0.22 }
    // front rack: front three-quarter, so the bar on the delts and the high elbows read
    if (params.hold === 'front_rack') return { az: FRONT_RACK_AZ, elev: 0.2 }
    // sumo dumbbell: nearly from the front, so the wide turned-out stance and the dumbbell hanging between the legs read
    if (params.hold === 'two_hand') return { az: -18, elev: 0.2 }
    // goblet: nearer the side, or the torso hides the dumbbell and the cupped hands
    return params.hold === 'goblet' ? { az: -115, elev: 0.22 } : { az: SQUAT_AZ, elev: 0.22 }
  },
  // kettlebells: palms in on the horns (goblet) or round the corner (front rack); sumo dumbbell: fingers hooked under the
  // head; the sled and swing arm side handles: a neutral wrap
  grip: (ctx) => {
    if (ctx.spec.kind === 'hack_sled' || ctx.spec.kind === 'pendulum_arm') return 'neutral'
    return ctx.spec.kind === 'kettlebell' ? 'neutral' : ctx.site.startsWith('hook_') ? 'hook' : undefined
  },
}

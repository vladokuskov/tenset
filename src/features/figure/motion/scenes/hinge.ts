import type { SceneSpec } from './types.ts'

/** behind the right hip, nearer the side than the squats: the hinge angle, the bar path and the posterior chain read */
const HINGE_AZ = -118

export const hinge: SceneSpec = {
  camera: (params) => {
    // pull-through: the stack stands behind the lifter, so the view comes round to the side to see past it
    if (params.implement === 'cable') return { az: -104, elev: 0.2 }
    // single leg: further behind, or the stance leg hides the dumbbell in the far hand at the top
    if (params.stance === 'single_leg') return { az: -155, elev: 0.22 }
    // sumo (wide floor pull): front three-quarter, so the toe-out and the knees pushed out over the toes read
    if (params.stance === 'wide' && params.start === 'floor') return { az: -40, elev: 0.22 }
    return { az: HINGE_AZ, elev: 0.2 }
  },
}

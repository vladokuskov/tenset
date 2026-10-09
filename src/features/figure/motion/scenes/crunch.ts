import type { SceneSpec } from './types.ts'

export const crunch: SceneSpec = {
  // floor: lying along the mat, the curl and the abs read from high on the foot side, round far enough that the near
  // knee stays off the belly; kneeling: side-on to the stack so the rounding back and the rope read
  camera: (params) => {
    // standing cable crunch: from the side and a little in front, the rounding back and the rope to the stack behind
    if (params.posture === 'standing') return { az: -70, elev: 0.2 }
    return params.posture === 'kneeling' ? { az: -55, elev: 0.22 } : { az: -58, elev: 0.36 }
  },
  // the spreading rope's fist pieces close the hand like the rope attachment; hands on the plate's rim
  grip: (ctx) => (ctx.spec.kind === 'rope_end' ? 'rope' : ctx.spec.kind === 'weight_plate' ? 'neutral' : undefined),
}

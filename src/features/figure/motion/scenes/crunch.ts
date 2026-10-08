import type { SceneSpec } from './types.ts'

export const crunch: SceneSpec = {
  // floor: lying along the mat, the curl and the abs read from high on the foot side, round far enough that the near
  // knee stays off the belly; kneeling: side-on to the stack so the rounding back and the rope read
  camera: (params) => (params.posture === 'kneeling' ? { az: -55, elev: 0.22 } : { az: -58, elev: 0.36 }),
  // the spreading rope's fist pieces close the hand like the rope attachment
  grip: (ctx) => (ctx.spec.kind === 'rope_end' ? 'rope' : undefined),
}

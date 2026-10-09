import type { SceneSpec } from './types.ts'

export const floorCore: SceneSpec = {
  // the body lies along the floor (or the bench), so the view is turned towards the side; lying face up is seen from a
  // little higher so the limbs read against the trunk
  camera: (params) => {
    if (params.kind === 'bird_dog') return { az: -65, elev: 0.3 }
    // the abs and hip flexors face the mat: a low view shows them (the high plank's precedent)
    if (params.kind === 'mountain_climber') return { az: -60, elev: 0.1 }
    if (params.kind === 'superman') return { az: -115, elev: 0.35 }
    return { az: -60, elev: 0.4 }
  },
  // flat palms on the mat; the reaching bird dog hand open; fingers round the bench's end (dragon flag)
  grip: (ctx) => {
    if (ctx.spec.kind !== 'palm_rest') return undefined
    if (ctx.spec.id === 'hands') return 'push-up-palm'
    return ctx.spec.id === 'reach' ? 'open' : 'pronated'
  },
}

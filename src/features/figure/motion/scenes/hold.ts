import type { SceneSpec } from './types.ts'

export const hold: SceneSpec = {
  camera: (params) => {
    // hand planks: low from the side-front, so the flat back, the hovering knees (bear) and the tapping hand read
    if (params.kind === 'bear_plank') return { az: -72, elev: 0.14 }
    if (params.kind === 'front_plank' && params.support === 'hand') return { az: -50, elev: 0.14 }
    // front plank: the abs face the floor, so a low view from the side-front shows them and the straight line
    if (params.kind === 'front_plank') return { az: -68, elev: 0.1 }
    // side plank: the body lies across the frame facing the camera, low enough to see the working side's flank
    if (params.kind === 'side_plank') return { az: -22, elev: 0.12 }
    // Copenhagen plank: low and nearly in front, so the underside of the top thigh (the working adductors) shows below
    // the body line, with the bench at the feet
    if (params.kind === 'copenhagen_plank') return { az: params.side === 'left' ? 12 : -12, elev: 0.04 }
    // suitcase hold: in front, turned towards the free side, so the far flank's obliques and the load both read
    if (params.kind === 'suitcase_hold') return { az: params.side === 'left' ? -25 : 25, elev: 0.2 }
    // hollow hold: from the side and a little above, where the curve from the shoulders to the feet reads
    if (params.kind === 'hollow_hold') return { az: -72, elev: 0.22 }
    // L-sit: from the side and a little in front, past the near bar, where the level legs and straight arms read
    if (params.kind === 'l_sit') return { az: -62, elev: 0.12 }
    return { az: -35, elev: 0.3 }
  },
  grip: (ctx) => {
    // band Pallof: the fists closed round the bunched band
    if (ctx.spec.kind === 'band_grip') return 'pronated'
    if (ctx.spec.kind !== 'palm_rest') return undefined
    // flat palms on the mat (hand planks), the tapping hand open; fists resting on the mat, the side plank's raised hand open
    if (ctx.spec.id === 'hands') return 'push-up-palm'
    return ctx.spec.id === 'reach' || ctx.spec.id === 'tap' ? 'open' : 'loose-fist'
  },
  // suitcase hold: the trunk resists bending towards the load, which works the far side's obliques hardest
  highlight: (base, _ex, params) => (params.kind === 'suitcase_hold' && base.side ? { ...base, side: base.side === 'l' ? 'r' : 'l' } : base),
}

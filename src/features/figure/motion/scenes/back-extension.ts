import type { SceneSpec } from './types.ts'

export const backExtension: SceneSpec = {
  camera: (params) => {
    // GHD: the body lies level, so from the side and a little behind the hips the fold over the round pad and the
    // posterior chain read, with the whole station in frame
    if (params.support === 'ghd') return { az: -105, elev: 0.28 }
    // behind the right hip: the back, glutes and hamstrings face up and back as the trunk hinges over the pad
    return { az: -128, elev: 0.3 }
  },
  // palms flat on the shoulders
  grip: (ctx) => (ctx.spec.kind === 'spot' ? 'open' : undefined),
}

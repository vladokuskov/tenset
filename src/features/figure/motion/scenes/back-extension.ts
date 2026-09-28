import type { SceneSpec } from './types.ts'

export const backExtension: SceneSpec = {
  // behind the right hip: the back, glutes and hamstrings face up and back as the trunk hinges over the pad
  camera: () => ({ az: -128, elev: 0.3 }),
  // palms flat on the shoulders
  grip: (ctx) => (ctx.spec.kind === 'spot' ? 'open' : undefined),
}

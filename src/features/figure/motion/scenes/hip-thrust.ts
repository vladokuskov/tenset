import type { SceneSpec } from './types.ts'

export const hipThrust: SceneSpec = {
  // lying across the bench or on the mat, the hip drive reads from the side; front-side on the bench so the near
  // plate stays clear of the hips, nearer the side on the mat
  camera: (params) => (params.support === 'floor' ? { az: -50, elev: 0.34 } : { az: -60, elev: 0.42 }),
  // palms flat on the mat
  grip: (ctx) => (ctx.spec.kind === 'spot' ? 'open' : undefined),
}

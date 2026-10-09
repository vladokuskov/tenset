import type { SceneSpec } from './types.ts'

export const rotation: SceneSpec = {
  // front three-quarter from the working side: the obliques and the diagonal handle path read, the stack stands clear;
  // the seated twist from the front-right side, where the lean back, the turn and the plate's sweep from hip to hip read
  camera: (params) => (params.posture === 'seated' ? { az: -45, elev: 0.3 } : { az: -30, elev: 0.26 }),
  // hands on the plate's rim, fists closed round the bunched band
  grip: (ctx) => (ctx.spec.kind === 'weight_plate' ? 'neutral' : ctx.spec.kind === 'band_grip' ? 'pronated' : undefined),
}

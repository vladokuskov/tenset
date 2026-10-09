import type { SceneSpec } from './types.ts'

export const pullover: SceneSpec = {
  // standing: rear three-quarter, turned to the side so the arm arc shows against the trunk; lying on the bench: from
  // the side, the dumbbell arc runs over the head
  camera: (params) => (params.posture === 'lying_supine' ? { az: -80, elev: 0.35 } : { az: -125, elev: 0.2 }),
}

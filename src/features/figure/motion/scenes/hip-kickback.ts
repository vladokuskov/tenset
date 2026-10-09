import type { SceneSpec } from './types.ts'

export const hipKickback: SceneSpec = {
  // rear three-quarter turned towards the side, so the leg's arc behind the body and the glutes read
  camera: (params) => (params.posture === 'lying_prone' ? { az: -110, elev: 0.35 } : { az: -120, elev: 0.2 }),
}

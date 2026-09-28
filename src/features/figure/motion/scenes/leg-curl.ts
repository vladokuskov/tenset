import type { SceneSpec } from './types.ts'

export const legCurl: SceneSpec = {
  camera: (params) => {
    // lying: behind the right hip and above, so the backs of the thighs and the heel's arc read
    if (params.posture === 'lying_prone') return { az: -125, elev: 0.36 }
    // Nordic: rear three-quarter turned towards the side, so the lowering and the catch stay in profile
    if (params.posture === 'kneeling') return { az: -112, elev: 0.22 }
    // seated: the thighs rest on the seat, so from nearly side-on and low the hamstrings read under the thigh
    return { az: -100, elev: 0.08 }
  },
  // the Nordic's free hands carry a partless marker so they can take a flat, open shape for the catch
  grip: (ctx) => (ctx.spec.kind === 'hand_pose' ? 'open' : undefined),
}

import type { SceneSpec } from './types.ts'

export const hipAbduction: SceneSpec = {
  camera: (params) => {
    const abduction = params.direction !== 'adduction'
    if (params.implement === 'machine') {
      // seated: the back pad hides the glutes from behind; a near-front three-quarter shows both knees travel with the
      // pads outside them and the outer hip (abduction), or looks down between the knees at the inner thighs (adduction)
      return abduction ? { az: -52, elev: 0.45 } : { az: -24, elev: 0.36 }
    }
    // seated band: from the front-left and above, the knees press apart round the band and the outer hips read
    if (params.implement === 'band') return { az: -40, elev: 0.42 }
    // side lying: from behind and above, so the top hip's glutes and the leg's lift read along the body
    if (params.posture === 'side_lying') return { az: params.side === 'left' ? 170 : -170, elev: 0.42 }
    // standing cable, right leg working: abduction from behind the working side so the glute med reads and the stack
    // stands clear on the far side; adduction from the front-left, the working inner thigh faces the camera
    const s = params.side === 'left' ? -1 : 1
    return abduction ? { az: -150 * s, elev: 0.18 } : { az: 26 * s, elev: 0.22 }
  },
  // the machine's side handles, the grab handle and (seated band) the bench pad's sides
  grip: (ctx) => (ctx.spec.kind === 'hip_machine' || ctx.spec.kind === 'grab_handle' || ctx.spec.kind === 'spot' ? 'neutral' : undefined),
}

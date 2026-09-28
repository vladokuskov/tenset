import { defaultCamera, type SceneSpec } from './types.ts'

export const row: SceneSpec = {
  camera: (params, mapView) => {
    // standing bar row: round towards the side so the hinge and the bar path read beside the back
    if (params.implement === 'barbell' && params.posture !== 'lying_supine') return { az: -120, elev: 0.24 }
    // inverted row: the back faces the floor; from the feet end and the side the body clears the rack's near uprights
    if (params.posture === 'lying_supine') return { az: -100, elev: 0.08 }
    // chest-supported: the lifter faces -Z on the incline, so this is behind its right shoulder and high enough that the
    // upper back, both flared elbows and the incline read
    if (params.support === 'chest_pad') return { az: 42, elev: 0.38 }
    // one-arm on the bench: from the working side and behind, the bench beyond the body
    if (params.support === 'bench') return { az: params.side === 'left' ? 105 : -105, elev: 0.22 }
    // face pull: rear three-quarter turned to the side, so the rope reads in front of the face, not across the back
    // of the head, with the rear delts and upper back still facing the camera
    if (params.finish === 'external_rotation') return { az: -118, elev: 0.22 }
    return defaultCamera(mapView)
  },
  grip: (ctx) => {
    if (ctx.spec.kind === 'row_rope_end') return 'rope'
    // the supporting hand rests flat on the bench
    if (ctx.spec.kind === 'bench' && ctx.site === 'hand') return 'bench-palm'
    return undefined
  },
}

import type { SceneSpec } from './types.ts'

export const tricepsExtension: SceneSpec = {
  camera: (params) => {
    // lying: from the lifter's right, a little towards the head and higher, so the arms' arc over the face reads
    if (params.posture === 'lying_supine') return { az: -115, elev: 0.35 }
    // kickback: from the working side, high enough that the triceps on top of the level upper arm reads
    if (params.support === 'bench') return { az: -95, elev: 0.3 }
    // seated overhead: nearer the side, so the forearms folding behind the head read past the torso
    if (params.posture === 'seated') return { az: -100, elev: 0.25 }
    // overhead cable: the raised arms turn the triceps forward, so a front three-quarter view nearer the side, where
    // the lean and the elbows' arc still read with the stack behind
    if (Number(params.shoulderFlexion) >= 150) return { az: -55, elev: 0.25 }
    // pushdowns: behind the right shoulder, turned towards the side so the triceps and the elbow's arc both read and
    // the stack stays clear of the hands
    return { az: -112, elev: 0.22 }
  },
  grip: (ctx) => {
    // the spreading rope's fist pieces close the hand like the rope attachment
    if (ctx.spec.kind === 'rope_end') return 'rope'
    // the supporting hand rests flat on the bench
    if (ctx.spec.kind === 'bench' && ctx.site === 'hand') return 'open'
    return undefined
  },
}

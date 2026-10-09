import type { SceneSpec } from './types.ts'

export const tricepsExtension: SceneSpec = {
  camera: (params) => {
    // Tate press: the elbows bend out to the sides, so from past the feet and high, where both arms' sideways fold reads
    if (params.posture === 'lying_supine' && params.elbowFlare !== undefined) return { az: -30, elev: 0.55 }
    // JM press: from past the feet on the lifter's right and raised, as the close-grip bench, so the arms and the
    // elbows drifting towards the feet read between the plates (from the side the near plate hides them)
    if (params.posture === 'lying_supine' && params.implement === 'barbell') return { az: -25, elev: 0.42 }
    // lying: from the lifter's right and higher, so the arms' arc over the face reads; near the side, since from
    // further towards the head the raised upper arm hides the triceps at lockout
    if (params.posture === 'lying_supine') return { az: -95, elev: 0.35 }
    // kickback: from the working side, high enough that the triceps on top of the level upper arm reads
    if (params.support === 'bench') return { az: -95, elev: 0.3 }
    // seated EZ overhead: from the side the bar's plates hide the hands, so a front three-quarter view where the
    // hands on the bends and the forearms folding behind the head both read
    if (params.posture === 'seated' && params.implement === 'ez_bar') return { az: -60, elev: 0.2 }
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
    // a bare band bunched in the fist closes the hand the same way
    if (ctx.spec.kind === 'band_grip') return 'rope'
    // the supporting hand rests flat on the bench
    if (ctx.spec.kind === 'bench' && ctx.site === 'hand') return 'open'
    return undefined
  },
}

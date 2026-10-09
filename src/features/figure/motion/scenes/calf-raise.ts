import type { SceneSpec } from './types.ts'

export const calfRaise: SceneSpec = {
  camera: (params) => {
    // tibialis raise: from the front and side, so the lean against the wall and the toe lift read in profile
    if (params.direction === 'dorsiflexion') return { az: -68, elev: 0.18 }
    // leg press: low from the right side, so the heels read dropping below the plate's lower edge under the near plates
    if (params.machine === 'leg_press') return { az: -118, elev: 0.36 }
    // hack squat sled: from the right side, so the heels dropping below the plate's low edge and the sled riding up the
    // rails read in profile
    if (params.machine === 'hack_squat') return { az: -95, elev: 0.12 }
    // seated: behind and to the side, the heels below the foot roller clear of the pad lever and plates
    if (params.machine === 'seated_calf') return { az: -130, elev: 0.24 }
    // standing machine: rear three-quarter as the squats, calves and the heel travel below the roller both read
    if (params.implement === 'machine') return { az: -128, elev: 0.16 }
    // Smith: from behind, as the Smith squat, so the view runs between the uprights onto both calves
    if (params.implement === 'smith') return { az: -163, elev: 0.1 }
    // step: low and more from the side than the squats' rear three-quarter, so the heel reads dropping below the tread
    // edge while the calf still faces the camera
    const s = params.side === 'left' ? -1 : 1
    return { az: -108 * s, elev: 0.1 }
  },
  grip: (ctx) => {
    if (ctx.spec.kind === 'wall') return 'wall-touch'
    // palms flat: on the mat behind (seated band tibialis raise), on the padded box (donkey raise)
    if (ctx.spec.kind === 'mat') return 'push-up-palm'
    if (ctx.spec.kind === 'plyo_box') return 'bench-palm'
    if (ctx.spec.kind === 'calf_machine' || ctx.spec.kind === 'seated_calf' || ctx.spec.kind === 'hack_sled') return 'neutral'
    return undefined
  },
}

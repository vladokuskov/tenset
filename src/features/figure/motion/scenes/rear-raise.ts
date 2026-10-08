import type { SceneSpec } from './types.ts'

export const rearRaise: SceneSpec = {
  camera: (params) => {
    // prone on the incline: the lifter faces -Z (the prone Y-raise's setup), so this is behind its left shoulder and
    // high, where the upper back and both arms' arcs read over the pad
    if (params.posture === 'lying_prone') return { az: 20, elev: 0.5 }
    // bent over: higher behind the right shoulder so the back and the arms' arc read over the hinge
    if (params.implement === 'dumbbell') return { az: -145, elev: 0.36 }
    // cable: from behind, so the towers in front of the lifter flank the figure instead of standing behind its head
    if (params.implement === 'cable') return { az: 180, elev: 0.36 }
    // machine: rear three-quarter, the pad in front of the lifter
    return { az: -145, elev: 0.24 }
  },
}

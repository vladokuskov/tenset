import type { SceneSpec } from './types.ts'

export const wristCurl: SceneSpec = {
  // the wrists move in the sagittal plane: nearer the side than the default three-quarter views, and high enough that
  // the forearms' upper face (flexors palms up, extensors palms down) reads on the bench
  // the palms-down barbell takes the palms-up view: from behind the right the bar's far sleeve crosses the face
  camera: (params) => {
    // behind the back: the bar and the palms face backwards, so a rear three-quarter view from the right
    if (params.posture === 'standing') return { az: -145, elev: 0.3 }
    // kneeling cable: from the front right and high, over the low pulley, so the stack does not widen the frame
    if (params.implement === 'cable') return { az: -40, elev: 0.5 }
    return params.grip === 'pronated' && params.implement !== 'barbell' ? { az: -112, elev: 0.34 } : { az: -62, elev: 0.36 }
  },
  // a bare band bunched in the fist closes the hand like the rope attachment
  grip: (ctx) => (ctx.spec.kind === 'band_grip' ? 'rope' : undefined),
}

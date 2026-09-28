import type { SceneSpec } from './types.ts'

export const wristCurl: SceneSpec = {
  // the wrists move in the sagittal plane: nearer the side than the default three-quarter views, and high enough that
  // the forearms' upper face (flexors palms up, extensors palms down) reads on the bench
  camera: (params) => (params.grip === 'pronated' ? { az: -112, elev: 0.34 } : { az: -62, elev: 0.36 }),
}

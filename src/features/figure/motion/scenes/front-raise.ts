import type { SceneSpec } from './types.ts'

export const frontRaise: SceneSpec = {
  camera: (params) => {
    // prone Y-raise: the lifter lies facing -Z, so this is just right of straight behind it and high: the Y reads on
    // both arms and the legs read as a straddle over the seat (further round, the far leg looks kicked out)
    if (params.posture === 'lying_prone') return { az: 15, elev: 0.45 }
    // standing: nearer the side than the default so the arc in the sagittal plane reads, front delts still in view
    return { az: -55, elev: 0.22 }
  },
}

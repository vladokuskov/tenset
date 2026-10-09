import { defaultCamera, type SceneSpec } from './types.ts'

export const verticalPress: SceneSpec = {
  camera: (params, mapView) => {
    // standing bar: further round to the side than the default, so the bar path past the face and the head moving
    // back and through read beside the front delts
    if (params.implement === 'barbell') return { az: -48, elev: 0.22 }
    // landmine (one hand, the right): from the pressing side and a little behind, so the arm's press up and forward
    // along the bar reads in profile instead of across the face, the bar running away to its pivot
    if (params.implement === 'landmine') return { az: -105, elev: 0.25 }
    return defaultCamera(mapView)
  },
}

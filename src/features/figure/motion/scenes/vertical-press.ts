import { defaultCamera, type SceneSpec } from './types.ts'

export const verticalPress: SceneSpec = {
  camera: (params, mapView) => {
    // standing bar: further round to the side than the default, so the bar path past the face and the head moving
    // back and through read beside the front delts
    if (params.implement === 'barbell') return { az: -48, elev: 0.22 }
    return defaultCamera(mapView)
  },
}

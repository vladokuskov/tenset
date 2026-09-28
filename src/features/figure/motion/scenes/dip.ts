import { defaultCamera, type SceneSpec } from './types.ts'

export const dip: SceneSpec = {
  // chest dip from the front three-quarter (chest and front delts), upright triceps dip from the rear three-quarter
  // (triceps): the station's bars run front to back, so both views see the hands on the bars past the near uprights
  camera: (_params, mapView) => defaultCamera(mapView),
}

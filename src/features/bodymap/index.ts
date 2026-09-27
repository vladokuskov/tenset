// Shared contract (owner: bodymap agent). Keep these props stable; replace internals freely.
export { BodyMap, type BodyMapProps, type BodyTint, type BodyValues, type BodyView } from './BodyMap'
export { BodyMini, type BodyMiniProps } from './BodyMini'
export { VolumeLegend } from './VolumeLegend'
export { AnatomyFigure, type AnatomyFigureProps, type FigureVars } from './AnatomyFigure'
export { tintVars } from './fills'
export {
  cropViewBox,
  loadAnatomy,
  regionBounds,
  TAP_RADIUS_PX,
  useAnatomy,
  type AnatomyDoc,
  type AnatomyKind,
  type AnatomyView,
  type Bounds,
} from './anatomy'
export { CoverageList } from './CoverageList'
export { Insights } from './Insights'
export { MuscleSheet, type MuscleSheetProps } from './MuscleSheet'
export { Why, type WhyProps } from './Why'

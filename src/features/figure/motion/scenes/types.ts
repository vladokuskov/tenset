import type { ImplementSpec } from '../../../../motion/implements.ts'
import type { GripName } from '../../hands.ts'
import type { LayoutSource } from '../../props/layout.ts'

// Per-template scene specifics for the composer (compose.ts), one module per template id (docs/FAMILIES.md).
// Types stay here (not in compose.ts) so the motion QA pipeline can load the scene modules.

export type MapView = 'F' | 'B'

/** camera azimuth (deg, 0 = in front, negative = towards the figure's right) and elevation (vertical component) */
export type CameraPreset = { az: number; elev: number }

export type MotionExercise = {
  id: number
  laterality: 'bilateral' | 'unilateral' | 'alternating'
  groups: Readonly<Record<string, 'primary' | 'secondary'>>
  media: { mapView: MapView }
}

/** worked muscles to draw (highlight.ts FigureHighlight) */
export type SceneHighlight = { primary?: readonly string[]; secondary?: readonly string[]; side?: 'l' | 'r' }

/** a hand holding an implement: its grip contact's implement and site */
export type GripContext = { params: Record<string, unknown>; spec: ImplementSpec; site: string; side: 'l' | 'r'; fingertips: boolean }

export type SceneSpec = {
  /** hero camera: azimuth (deg, 0 = in front, negative = towards the figure's right) and elevation */
  camera: (params: Record<string, unknown>, mapView: MapView) => CameraPreset
  /** hand shape for a holding hand; undefined keeps the composer's rule (compose.ts wrapStyle) */
  grip?: (ctx: GripContext) => GripName | undefined
  /** adjusts the record's highlight (primary/secondary groups, working side) */
  highlight?: (base: SceneHighlight, ex: MotionExercise, params: Record<string, unknown>) => SceneHighlight
  /** equipment this template draws beyond its implements; drawn by the composer and collided by the QA gate */
  layouts?: LayoutSource
}

/** front three-quarter for exercises whose muscles read from the front (mapView F), rear three-quarter for B */
export function defaultCamera(mapView: MapView): CameraPreset {
  return mapView === 'B' ? { az: -145, elev: 0.2 } : { az: -35, elev: 0.3 }
}

/** a template whose scene is not authored yet: the default camera, the composer's grips and highlight */
export function pendingScene(): SceneSpec {
  return { camera: (_params, mapView) => defaultCamera(mapView) }
}

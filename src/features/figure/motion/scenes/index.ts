import type { TemplateId } from '../../../../motion/templates/schemas.ts'
import { backExtension } from './back-extension.ts'
import { calfRaise } from './calf-raise.ts'
import { crunch } from './crunch.ts'
import { curl } from './curl.ts'
import { dip } from './dip.ts'
import { externalRotation } from './external-rotation.ts'
import { fly } from './fly.ts'
import { frontRaise } from './front-raise.ts'
import { hinge } from './hinge.ts'
import { hipAbduction } from './hip-abduction.ts'
import { hipThrust } from './hip-thrust.ts'
import { hold } from './hold.ts'
import { horizontalPress } from './horizontal-press.ts'
import { inclinePress } from './incline-press.ts'
import { lateralRaise } from './lateral-raise.ts'
import { legCurl } from './leg-curl.ts'
import { legExtension } from './leg-extension.ts'
import { legRaise } from './leg-raise.ts'
import { lunge } from './lunge.ts'
import { pushUp } from './push-up.ts'
import { rearRaise } from './rear-raise.ts'
import { rotation } from './rotation.ts'
import { row } from './row.ts'
import { shrug } from './shrug.ts'
import { squat } from './squat.ts'
import { tricepsExtension } from './triceps-extension.ts'
import { pendingScene, type SceneSpec } from './types.ts'
import { verticalPress } from './vertical-press.ts'
import { verticalPull } from './vertical-pull.ts'
import { wristCurl } from './wrist-curl.ts'

export { defaultCamera, pendingScene, type CameraPreset, type GripContext, type MapView, type MotionExercise, type SceneHighlight, type SceneSpec } from './types.ts'

// One scene module per template id: a family agent edits only its own template's scene module.
export const SCENES: Record<TemplateId, SceneSpec> = {
  'horizontal-press': horizontalPress,
  'incline-press': inclinePress,
  'vertical-press': verticalPress,
  dip,
  'push-up': pushUp,
  fly,
  'lateral-raise': lateralRaise,
  'front-raise': frontRaise,
  'rear-raise': rearRaise,
  'external-rotation': externalRotation,
  row,
  'vertical-pull': verticalPull,
  shrug,
  squat,
  lunge,
  'leg-extension': legExtension,
  hinge,
  'hip-thrust': hipThrust,
  'leg-curl': legCurl,
  'back-extension': backExtension,
  'hip-abduction': hipAbduction,
  'calf-raise': calfRaise,
  curl,
  'triceps-extension': tricepsExtension,
  'wrist-curl': wristCurl,
  crunch,
  'leg-raise': legRaise,
  hold,
  rotation,
}

const fallback = pendingScene()

export function sceneFor(template: string): SceneSpec {
  return (SCENES as Record<string, SceneSpec>)[template] ?? fallback
}

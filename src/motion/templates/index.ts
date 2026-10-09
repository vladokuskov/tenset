import type { Skeleton } from '../skeleton.ts'
import { backExtension } from './back-extension.ts'
import { calfRaise } from './calf-raise.ts'
import { crunch } from './crunch.ts'
import { curl } from './curl.ts'
import { dip } from './dip.ts'
import { externalRotation } from './external-rotation.ts'
import { floorCore } from './floor-core.ts'
import { fly } from './fly.ts'
import { frontRaise } from './front-raise.ts'
import { hinge } from './hinge.ts'
import { hipAbduction } from './hip-abduction.ts'
import { hipKickback } from './hip-kickback.ts'
import { hipThrust } from './hip-thrust.ts'
import { hold } from './hold.ts'
import { horizontalPress } from './horizontal-press.ts'
import { inclinePress } from './incline-press.ts'
import { lateralRaise } from './lateral-raise.ts'
import { legCurl } from './leg-curl.ts'
import { legExtension } from './leg-extension.ts'
import { legRaise } from './leg-raise.ts'
import { lunge } from './lunge.ts'
import { pullover } from './pullover.ts'
import { pushUp } from './push-up.ts'
import { rearRaise } from './rear-raise.ts'
import { rollout } from './rollout.ts'
import { rotation } from './rotation.ts'
import { row } from './row.ts'
import { SCHEMAS, TEMPLATE_IDS, type TemplateId } from './schemas.ts'
import { shrug } from './shrug.ts'
import { squat } from './squat.ts'
import { swing } from './swing.ts'
import { tricepsExtension } from './triceps-extension.ts'
import type { AnyTemplate } from './types.ts'
import { verticalPress } from './vertical-press.ts'
import { verticalPull } from './vertical-pull.ts'
import { wristCurl } from './wrist-curl.ts'

export { SCHEMAS, TEMPLATE_IDS, type ParamsOf, type TemplateId } from './schemas.ts'
export type { AnyTemplate, BalanceSpec, Cable, Driver, Rest, Setup, Template, Tolerances } from './types.ts'

// One module per template id (docs/FAMILIES.md): a family agent edits only its own template files, and the
// implemented flag lives in the module.
const MODULES = [
  horizontalPress, inclinePress, verticalPress, dip, pushUp, fly, lateralRaise, frontRaise, rearRaise, externalRotation, row,
  verticalPull, shrug, squat, lunge, legExtension, hinge, hipThrust, legCurl, backExtension, hipAbduction, calfRaise, curl,
  tricepsExtension, wristCurl, crunch, legRaise, hold, rotation, rollout, floorCore, pullover, swing, hipKickback,
] as unknown as AnyTemplate[]

const byId = new Map(MODULES.map((t) => [t.id, t]))
if (byId.size !== MODULES.length || TEMPLATE_IDS.some((id) => !byId.has(id))) {
  throw new Error(`motion templates: every template id needs exactly one module (missing ${TEMPLATE_IDS.filter((id) => !byId.has(id)).join(', ') || 'none'})`)
}

export const TEMPLATES: Record<TemplateId, AnyTemplate> = Object.fromEntries(TEMPLATE_IDS.map((id) => [id, byId.get(id)!])) as Record<TemplateId, AnyTemplate>

export function isTemplateId(id: unknown): id is TemplateId {
  return typeof id === 'string' && id in SCHEMAS
}

export function getTemplate(id: string): AnyTemplate {
  if (!isTemplateId(id)) throw new Error(`unknown motion template ${id}`)
  return TEMPLATES[id]
}

/** validate media.params (plus the record's laterality) against the frozen schema */
export function parseParams(id: string, params: unknown, laterality?: string): Record<string, unknown> {
  const t = getTemplate(id)
  const raw = { ...(params as object), ...(laterality ? { laterality } : {}) }
  return t.params.parse(raw)
}

export function samplePose(id: string, phase: number, params: Record<string, unknown>, skel: Skeleton) {
  return getTemplate(id).sample(phase, params, skel)
}

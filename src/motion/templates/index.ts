import type { Skeleton } from '../skeleton.ts'
import { curl } from './curl.ts'
import { lateralRaise } from './lateral-raise.ts'
import { SCHEMAS, TEMPLATE_IDS, type TemplateId } from './schemas.ts'
import { squat } from './squat.ts'
import type { AnyTemplate, Driver, Template } from './types.ts'
import { verticalPull } from './vertical-pull.ts'

export { SCHEMAS, TEMPLATE_IDS, type ParamsOf, type TemplateId } from './schemas.ts'
export type { AnyTemplate, BalanceSpec, Cable, Driver, Rest, Setup, Template } from './types.ts'

const DRIVERS: Record<TemplateId, Driver> = {
  'horizontal-press': 'implement',
  'incline-press': 'implement',
  'vertical-press': 'implement',
  dip: 'root',
  'push-up': 'root',
  fly: 'joint',
  'lateral-raise': 'joint',
  'front-raise': 'joint',
  'rear-raise': 'joint',
  'external-rotation': 'joint',
  row: 'implement',
  'vertical-pull': 'root',
  shrug: 'joint',
  squat: 'implement',
  lunge: 'root',
  'leg-extension': 'joint',
  hinge: 'implement',
  'hip-thrust': 'root',
  'leg-curl': 'joint',
  'back-extension': 'root',
  'hip-abduction': 'joint',
  'calf-raise': 'root',
  curl: 'joint',
  'triceps-extension': 'joint',
  'wrist-curl': 'joint',
  crunch: 'joint',
  'leg-raise': 'joint',
  hold: 'root',
  rotation: 'joint',
}

function pending(id: TemplateId): AnyTemplate {
  const fail = () => {
    throw new Error(`motion template ${id}: sample() not implemented yet`)
  }
  return { id, driver: DRIVERS[id], params: SCHEMAS[id] as never, implemented: false, setup: fail, sample: fail }
}

const IMPLEMENTED = [squat, lateralRaise, verticalPull, curl] as Template<never>[]

export const TEMPLATES: Record<TemplateId, AnyTemplate> = Object.fromEntries(
  TEMPLATE_IDS.map((id) => [id, (IMPLEMENTED.find((t) => t.id === id) as AnyTemplate | undefined) ?? pending(id)]),
) as Record<TemplateId, AnyTemplate>

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

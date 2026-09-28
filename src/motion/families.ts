import type { TemplateId } from './templates/schemas.ts'

// Template families for parallel authoring (docs/FAMILIES.md): each family agent owns its templates, their scene
// modules and its extension modules. The approved S1 templates (squat, lateral-raise, vertical-pull, curl) belong to
// no family.

export type FamilyName =
  | 'press-horizontal'
  | 'press-vertical-bodyweight'
  | 'chest-shoulder-isolation'
  | 'back'
  | 'legs-knee'
  | 'legs-hip-calf'
  | 'hinge'
  | 'arms'
  | 'core'

export type Family = { code: string; templates: Partial<Record<TemplateId, number[]>> }

export const FAMILIES: Record<FamilyName, Family> = {
  'press-horizontal': { code: 'F1', templates: { 'horizontal-press': [101, 107, 108, 707], 'incline-press': [102, 103, 109] } },
  'press-vertical-bodyweight': { code: 'F2', templates: { 'vertical-press': [201, 202, 208, 212], dip: [104, 718], 'push-up': [106, 113, 114, 115] } },
  'chest-shoulder-isolation': {
    code: 'F3',
    templates: { fly: [105, 110, 111, 112], 'front-raise': [207, 209], 'rear-raise': [205, 210, 213], 'external-rotation': [211, 215] },
  },
  back: { code: 'F4', templates: { row: [206, 304, 305, 306, 307, 312, 313, 315], shrug: [308, 314] } },
  'legs-knee': { code: 'F5', templates: { lunge: [403, 409, 410, 411], 'leg-extension': [404, 412], 'leg-curl': [503, 504, 512] } },
  'legs-hip-calf': { code: 'F6', templates: { 'hip-abduction': [506, 507, 514, 515], 'calf-raise': [601, 602, 603, 604, 605, 606] } },
  hinge: { code: 'F7', templates: { hinge: [501, 508, 509, 510, 513], 'hip-thrust': [502, 511], 'back-extension': [505] } },
  arms: { code: 'F8', templates: { 'triceps-extension': [704, 705, 706, 715, 716, 717], 'wrist-curl': [708, 709] } },
  core: { code: 'F9', templates: { crunch: [801, 805], 'leg-raise': [802, 806, 807], hold: [803, 804, 808], rotation: [809] } },
}

export const FAMILY_NAMES = Object.keys(FAMILIES) as FamilyName[]

/** templates approved before the family split */
export const S1_TEMPLATES: TemplateId[] = ['squat', 'lateral-raise', 'vertical-pull', 'curl']

export function isFamilyName(v: unknown): v is FamilyName {
  return typeof v === 'string' && v in FAMILIES
}

/** exercise ids of a family, by code (F1) or name */
export function familyExercises(family: string): number[] {
  const f = Object.entries(FAMILIES).find(([name, x]) => name === family || x.code === family.toUpperCase())?.[1]
  if (!f) throw new Error(`unknown family ${family}; one of ${FAMILY_NAMES.join(', ')} or F1-F9`)
  return Object.values(f.templates).flat().sort((a, b) => a - b)
}

export function familyOf(template: string): FamilyName | null {
  return FAMILY_NAMES.find((n) => template in FAMILIES[n].templates) ?? null
}

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
  'press-horizontal': { code: 'F1', templates: { 'horizontal-press': [101, 107, 108, 116, 117, 118, 119, 120, 121, 124, 128, 135, 707], 'incline-press': [102, 103, 109, 122, 123, 136] } },
  'press-vertical-bodyweight': { code: 'F2', templates: { 'vertical-press': [201, 202, 208, 212, 216, 217, 218, 219, 220, 221, 222, 235], dip: [104, 127, 718, 733], 'push-up': [106, 113, 114, 115, 125, 126, 134, 223, 732] } },
  'chest-shoulder-isolation': {
    code: 'F3',
    templates: { fly: [105, 110, 111, 112, 129, 130, 131, 132, 133], 'front-raise': [207, 209, 233, 234, 236], 'rear-raise': [205, 210, 213, 228, 230, 231], 'external-rotation': [211, 215, 232] },
  },
  back: { code: 'F4', templates: { row: [206, 229, 304, 305, 306, 307, 312, 313, 315, 317, 318, 319, 320, 321, 322, 323, 324, 338, 339, 340], shrug: [227, 308, 314, 335, 336, 337, 341], pullover: [325, 326, 327] } },
  'legs-knee': { code: 'F5', templates: { lunge: [403, 409, 410, 411, 423, 424, 425, 426, 430, 431, 433, 434], 'leg-extension': [404, 412, 435], 'leg-curl': [503, 504, 512, 526, 539, 540, 541] } },
  'legs-hip-calf': { code: 'F6', templates: { 'hip-abduction': [506, 507, 514, 515, 536, 537], 'calf-raise': [601, 602, 603, 604, 605, 606, 607, 608, 609, 610, 611, 612] } },
  hinge: { code: 'F7', templates: { hinge: [501, 508, 509, 510, 513, 516, 517, 519, 520, 521, 522, 523, 524, 525, 542], 'hip-thrust': [502, 511, 529, 530, 531, 533], 'back-extension': [505, 527], swing: [518], 'hip-kickback': [528, 534] } },
  arms: { code: 'F8', templates: { 'triceps-extension': [704, 705, 706, 715, 716, 717, 731, 734, 735, 736, 737, 738, 739, 740, 741, 742, 743, 744, 745], 'wrist-curl': [708, 709, 746, 747, 748, 749, 750] } },
  core: { code: 'F9', templates: { crunch: [801, 805, 817, 818, 834, 838, 840], 'leg-raise': [802, 806, 807, 819, 825, 826, 827, 836], hold: [538, 803, 804, 808, 815, 823, 824, 828, 829, 830, 835, 841], rotation: [809, 821, 822, 831, 832, 833], rollout: [810, 811, 812], 'floor-core': [813, 814, 816, 820, 837, 839, 842] } },
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

import type { Pattern } from '../../domain/schema'
import type { Locale } from '../../i18n/locale'
import { getLocale } from '../../i18n/messages'
import { catalogMessages } from './messages'

export type PatternGroupId = keyof (typeof catalogMessages)['en']['patternGroup']

/** Pattern groups for pickers, in display order. Labels come from patternGroupLabel. */
export const PATTERN_GROUPS: readonly { id: PatternGroupId; patterns: readonly Pattern[] }[] = [
  { id: 'push', patterns: ['horizontal_push', 'incline_push', 'vertical_push', 'dip', 'shoulder_horizontal_adduction'] },
  { id: 'pull', patterns: ['horizontal_pull', 'vertical_pull', 'shoulder_extension', 'scapular_elevation'] },
  {
    id: 'shoulders',
    patterns: ['shoulder_abduction', 'shoulder_flexion', 'shoulder_horizontal_abduction', 'shoulder_external_rotation', 'scapular_upward_rotation'],
  },
  { id: 'arms', patterns: ['elbow_flexion', 'elbow_extension', 'wrist_flexion', 'wrist_extension'] },
  {
    id: 'legs',
    patterns: ['squat', 'lunge', 'hinge', 'hip_extension', 'knee_extension', 'knee_flexion', 'hip_abduction', 'hip_adduction', 'plantarflexion', 'dorsiflexion'],
  },
  {
    id: 'core',
    patterns: ['spinal_flexion', 'spinal_extension', 'hip_flexion', 'anti_extension', 'anti_lateral_flexion', 'anti_rotation', 'rotation'],
  },
]

export const PATTERNS: readonly Pattern[] = Object.keys(catalogMessages.en.pattern) as Pattern[]

export function patternLabel(pattern: Pattern | undefined, locale: Locale = getLocale()): string {
  return pattern ? catalogMessages[locale].pattern[pattern] : ''
}

export function patternGroupLabel(id: PatternGroupId, locale: Locale = getLocale()): string {
  return catalogMessages[locale].patternGroup[id]
}

export function levelLabel(level: number, locale: Locale = getLocale()): string {
  return catalogMessages[locale].level[level] ?? String(level)
}


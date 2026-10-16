import { MOVEMENT_GROUPS, type MovementKey } from '../../domain/movement'
import type { Pattern } from '../../domain/schema'
import type { Locale } from '../../i18n/locale'
import { getLocale } from '../../i18n/messages'
import { catalogMessages } from './messages'

export { movementGroupOf, type MovementKey } from '../../domain/movement'

/** Pattern groups for pickers, in display order. Labels come from patternGroupLabel. */
export const PATTERN_GROUPS = MOVEMENT_GROUPS

export const PATTERNS: readonly Pattern[] = Object.keys(catalogMessages.en.pattern) as Pattern[]

export function patternLabel(pattern: Pattern | undefined, locale: Locale = getLocale()): string {
  return pattern ? catalogMessages[locale].pattern[pattern] : ''
}

export function patternGroupLabel(id: MovementKey, locale: Locale = getLocale()): string {
  return catalogMessages[locale].patternGroup[id]
}

export function levelLabel(level: number, locale: Locale = getLocale()): string {
  return catalogMessages[locale].level[level] ?? String(level)
}


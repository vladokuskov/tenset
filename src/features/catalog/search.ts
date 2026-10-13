import { equipmentName, groupName } from '../../data/localize'
import { hasEquipment } from '../../domain/equipment'
import { buildCatalogIndex, searchCatalog, type CatalogIndex, type SearchLabels } from '../../domain/search'
import type { Exercise, Pattern, Prefs } from '../../domain/schema'
import { common } from '../../i18n/common'
import type { Locale } from '../../i18n/locale'
import { getLocale } from '../../i18n/messages'
import { patternLabel } from './patterns'
import { applyOverride } from './roles'

export { tokenize, type CatalogIndex } from '../../domain/search'

const labelsFor = (locale: Locale): SearchLabels => ({
  group: (id) => groupName(id, locale),
  equipment: (id) => equipmentName(id, locale),
  pattern: (p) => patternLabel(p, locale),
  bodyweight: common[locale].bodyweight,
})

/** Pass already localized exercises (useCatalog); groups, equipment and patterns index in the same language. */
export function buildIndex(
  exercises: readonly Exercise[],
  locale: Locale = getLocale(),
  processTerm?: (term: string) => string,
): CatalogIndex {
  return buildCatalogIndex(exercises, labelsFor(locale), processTerm)
}

export type CatalogFilters = {
  q?: string
  muscle?: string
  /** Only exercises the listed equipment allows; undefined means any equipment. */
  available?: readonly string[]
  pattern?: Pattern
  level?: number
}

/** Filtered exercises: by search score when there is a query, otherwise in catalog order. */
export function filterExercises(
  exercises: readonly Exercise[],
  index: CatalogIndex,
  filters: CatalogFilters,
  overrides: Prefs['overrides'] = {},
): Exercise[] {
  const available = filters.available ? new Set(filters.available) : null
  const roles = (e: Exercise) => applyOverride(e.groups, overrides[String(e.id)])
  const keep = (e: Exercise) =>
    (!available || hasEquipment(e, available)) &&
    (!filters.pattern || e.pattern === filters.pattern) &&
    (!filters.level || e.level === filters.level) &&
    (!filters.muscle || roles(e)[filters.muscle] === 'primary')
  return searchCatalog(exercises, index, filters.q ?? '', roles).filter(keep)
}

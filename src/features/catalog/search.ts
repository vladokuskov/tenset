import MiniSearch from 'minisearch'
import { equipment as equipmentList, hasEquipment } from '../../domain/equipment'
import type { Exercise, Pattern, Prefs, Role } from '../../domain/schema'
import { getGroup } from '../../domain/taxonomy'
import { PATTERN_LABEL } from './patterns'
import { applyOverride } from './roles'

const equipmentName = new Map(equipmentList.map((e) => [e.id, e.name]))

type Doc = {
  id: number
  name: string
  aliases: string
  equipment: string
  primary: string
  secondary: string
  pattern: string
}

const groupNames = (groups: Readonly<Record<string, Role>>, role: Role) =>
  Object.entries(groups)
    .filter(([, r]) => r === role)
    .map(([g]) => getGroup(g)?.name ?? g)
    .join(' ')

// "Pull-up" also indexes as "pullup", so both spellings match.
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const word of text.toLowerCase().split(/[\s,()+]+/)) {
    const clean = word.replace(/['’.]/g, '')
    if (!clean) continue
    const parts = clean.split(/[-/]+/).filter(Boolean)
    out.push(...parts)
    if (parts.length > 1) out.push(parts.join(''))
  }
  return out
}

export type CatalogIndex = MiniSearch<Doc>

export function buildIndex(exercises: readonly Exercise[]): CatalogIndex {
  const index = new MiniSearch<Doc>({
    fields: ['name', 'aliases', 'equipment', 'primary', 'secondary', 'pattern'],
    tokenize,
    searchOptions: {
      boost: { name: 3, aliases: 2.5, primary: 1.5, pattern: 1.2, secondary: 0.4 },
      prefix: true,
      fuzzy: (term) => (term.length > 4 ? 0.2 : false),
      combineWith: 'AND',
    },
  })
  index.addAll(
    exercises.map((e) => ({
      id: e.id,
      name: e.name,
      aliases: e.aliases.join(' , '),
      equipment: e.equipment.length ? e.equipment.map((id) => equipmentName.get(id) ?? id).join(' , ') : 'bodyweight',
      primary: groupNames(e.groups, 'primary'),
      secondary: groupNames(e.groups, 'secondary'),
      pattern: PATTERN_LABEL[e.pattern],
    })),
  )
  return index
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
  const q = filters.q?.trim()
  const available = filters.available ? new Set(filters.available) : null
  const keep = (e: Exercise) =>
    (!available || hasEquipment(e, available)) &&
    (!filters.pattern || e.pattern === filters.pattern) &&
    (!filters.level || e.level === filters.level) &&
    (!filters.muscle || applyOverride(e.groups, overrides[String(e.id)])[filters.muscle] === 'primary')

  if (!q) return exercises.filter(keep)
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const out: Exercise[] = []
  for (const hit of index.search(q)) {
    const e = byId.get(hit.id as number)
    if (e && keep(e)) out.push(e)
  }
  return out
}

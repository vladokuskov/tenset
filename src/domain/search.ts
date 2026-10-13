import MiniSearch from 'minisearch'
import { equipment } from './equipment.ts'
import { patternNames } from './patternNames.ts'
import type { Exercise, Pattern, Role } from './schema.ts'
import { groups } from './taxonomy.ts'

// Exercise search shared by the app catalog and the agent API, so both return the same results.

export type SearchLabels = {
  group: (id: string) => string
  equipment: (id: string) => string
  pattern: (pattern: Pattern) => string
  bodyweight: string
}

const nameOf = (list: readonly { id: string; name: string }[]) => {
  const names = new Map(list.map((x) => [x.id, x.name]))
  return (id: string) => names.get(id) ?? id
}

/** The English labels the app indexes; the agent API searches with these. */
export const englishSearchLabels: SearchLabels = {
  group: nameOf(groups),
  equipment: nameOf(equipment),
  pattern: (p) => patternNames.en[p],
  bodyweight: 'Bodyweight',
}

type Doc = {
  id: number
  name: string
  aliases: string
  equipment: string
  primary: string
  secondary: string
  pattern: string
}

export type CatalogIndex = MiniSearch<Doc> & { readonly groupTerms: ReadonlyMap<string, readonly string[]> }

// "Pull-up" also indexes as "pullup", so both spellings match. Apostrophes fold away: мʼяз, м'яз, м’яз.
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const word of text.toLowerCase().split(/[\s,()+«»"]+/)) {
    const clean = word.replace(/['’ʼ`.]/g, '')
    if (!clean) continue
    const parts = clean.split(/[-/]+/).filter(Boolean)
    out.push(...parts)
    if (parts.length > 1) out.push(parts.join(''))
  }
  return out
}

const groupNames = (groups: Readonly<Record<string, Role>>, role: Role, labels: SearchLabels) =>
  Object.entries(groups)
    .filter(([, r]) => r === role)
    .map(([g]) => labels.group(g))
    .join(' ')

/** Pass exercises and labels in the same language. processTerm applies to indexed and searched terms alike. */
export function buildCatalogIndex(
  exercises: readonly Exercise[],
  labels: SearchLabels,
  processTerm?: (term: string) => string,
): CatalogIndex {
  const index = new MiniSearch<Doc>({
    fields: ['name', 'aliases', 'equipment', 'primary', 'secondary', 'pattern'],
    tokenize,
    ...(processTerm ? { processTerm } : {}),
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
      equipment: e.equipment.length ? e.equipment.map(labels.equipment).join(' , ') : labels.bodyweight,
      primary: groupNames(e.groups, 'primary', labels),
      secondary: groupNames(e.groups, 'secondary', labels),
      pattern: e.pattern ? labels.pattern(e.pattern) : '',
    })),
  )
  const groupIds = new Set(exercises.flatMap((e) => Object.keys(e.groups)))
  const groupTerms = new Map([...groupIds].map((id) => [id, tokenize(labels.group(id))]))
  return Object.assign(index, { groupTerms })
}

const MUSCLE_QUERY_MIN = 3

/** Groups whose name the query spells out or starts: "chest", "back" (upper and lower back), "біцепс". */
export function muscleGroupsIn(index: CatalogIndex, query: string): string[] {
  const words = tokenize(query)
  if (words.join('').length < MUSCLE_QUERY_MIN) return []
  const out: string[] = []
  for (const [id, terms] of index.groupTerms) {
    if (words.every((w) => terms.some((t) => t.startsWith(w)))) out.push(id)
  }
  return out
}

/**
 * Exercises matching the query, best first. When the query names a muscle group, exercises with that
 * group as a primary mover come first, each part keeping its score order.
 */
export function searchCatalog<E extends Exercise>(
  exercises: readonly E[],
  index: CatalogIndex,
  query: string,
  rolesOf: (e: E) => Readonly<Record<string, Role>> = (e) => e.groups,
): E[] {
  const q = query.trim()
  if (!q) return [...exercises]
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const hits: E[] = []
  for (const hit of index.search(q)) {
    const e = byId.get(hit.id as number)
    if (e) hits.push(e)
  }
  const muscles = muscleGroupsIn(index, q)
  if (!muscles.length) return hits
  const primary = (e: E) => muscles.some((g) => rolesOf(e)[g] === 'primary')
  return [...hits.filter(primary), ...hits.filter((e) => !primary(e))]
}

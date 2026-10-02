import { parseLine } from '../../domain/importText'
import type { CustomExercise, Exercise, ExerciseRef } from '../../domain/schema'
import type { Locale } from '../../i18n/locale'
import { matchesQuery, normalize } from '../builder/labels'
import { buildIndex, tokenize } from '../catalog/search'

export type MatchCandidate = { ref: ExerciseRef; name: string }
/** exact: name or alias equals the line; good: clear top hit; weak: worth a look; none: nothing found. */
export type MatchConfidence = 'exact' | 'good' | 'weak' | 'none'
export type MatchResult = { best: MatchCandidate | null; confidence: MatchConfidence; alternatives: MatchCandidate[] }

export type Matcher = {
  match: (name: string) => MatchResult
  search: (query: string, limit?: number) => MatchCandidate[]
}

const MATCH_OPTIONS = { boost: { name: 3, aliases: 2.5 }, combineWith: 'OR', fuzzy: 0.2, prefix: true } as const
const CLEAR_LEAD = 1.5

/** "Bench press 3x8" -> "Bench press"; the parser already does this for its lines, pasted names may not be clean. */
export function cleanQuery(name: string): string {
  return (parseLine(name)?.name ?? name).replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim()
}

const singular = (q: string) =>
  q
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ')

const toCandidate = (e: Exercise | CustomExercise): MatchCandidate => ({ ref: e.id, name: e.name })

/** Pass localized exercises (useCatalog), so names and aliases match in both languages. */
export function createMatcher(exercises: readonly Exercise[], custom: readonly CustomExercise[], locale: Locale): Matcher {
  const index = buildIndex(exercises, locale)
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const exact = new Map<string, Exercise | CustomExercise>()
  for (const e of exercises) {
    for (const n of [e.name, ...e.aliases]) {
      const key = normalize(n)
      if (key && !exact.has(key)) exact.set(key, e)
    }
  }
  for (const c of custom) exact.set(normalize(c.name), c)

  const findExact = (q: string) => exact.get(normalize(q)) ?? exact.get(singular(normalize(q)))

  const match = (name: string): MatchResult => {
    const q = cleanQuery(name)
    if (!q) return { best: null, confidence: 'none', alternatives: [] }
    const customHits = custom.filter((c) => matchesQuery(c, q)).map(toCandidate)
    const hits = index.search(q, MATCH_OPTIONS)
    const catalogHits = hits.map((h) => byId.get(h.id as number)).filter((e): e is Exercise => !!e).map(toCandidate)
    const pool = dedupe([...customHits, ...catalogHits])

    const sure = findExact(q)
    if (sure) {
      const best = toCandidate(sure)
      return { best, confidence: 'exact', alternatives: pool.filter((c) => c.ref !== best.ref).slice(0, 3) }
    }
    if (!pool.length) return { best: null, confidence: 'none', alternatives: [] }

    const terms = new Set(tokenize(q))
    const top = hits[0]
    const coversQuery = !!top && [...terms].every((t) => top.queryTerms.includes(t))
    const lead = top && hits[1] ? top.score / hits[1].score : Infinity
    const best = catalogHits[0] ?? pool[0]
    const confidence: MatchConfidence = top && coversQuery && lead >= CLEAR_LEAD ? 'good' : 'weak'
    return { best, confidence, alternatives: pool.filter((c) => c.ref !== best.ref).slice(0, 3) }
  }

  const search = (query: string, limit = 6): MatchCandidate[] => {
    const q = query.trim()
    if (!q) return []
    const customHits = custom.filter((c) => matchesQuery(c, q)).map(toCandidate)
    let hits = index.search(q)
    if (!hits.length) hits = index.search(q, MATCH_OPTIONS)
    const catalogHits = hits.map((h) => byId.get(h.id as number)).filter((e): e is Exercise => !!e).map(toCandidate)
    return dedupe([...customHits, ...catalogHits]).slice(0, limit)
  }

  return { match, search }
}

function dedupe(list: readonly MatchCandidate[]): MatchCandidate[] {
  const seen = new Set<ExerciseRef>()
  return list.filter((c) => !seen.has(c.ref) && seen.add(c.ref))
}

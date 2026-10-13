import { inputAliases } from '../../data/aliases'
import { translatedNames } from '../../data/localize'
import { parseLine } from '../../domain/importText'
import type { CustomExercise, Exercise, ExerciseRef } from '../../domain/schema'
import type { Locale } from '../../i18n/locale'
import { matchesQuery, normalize } from '../builder/labels'
import { buildIndex, tokenize } from '../catalog/search'
import { stem } from './stem'

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

// Small words that only add noise to a scored search. Exact lookups still see them.
const STOP = new Set([
  'a', 'an', 'the', 'with', 'on', 'of', 'for', 'and', 'to', 'in', 'at',
  'на', 'з', 'зі', 'із', 'в', 'у', 'до', 'для', 'і', 'й', 'та', 'и', 'с', 'со', 'по', 'к', 'от', 'від', 'під', 'под', 'за',
])

// Words too broad to carry a match alone: a name that shares only these with an exercise is a different movement.
const GENERIC = new Set(
  'walk walking carry push pull jump box hold run drag throw crawl press raise curl row fly extension kick cable machine band dumbbell barbell kettlebell db bb kb'
    .split(' ')
    .map(stem),
)

/** "Bench press 3x8" -> "Bench press"; the parser already does this for its lines, pasted names may not be clean. */
export function cleanQuery(name: string): string {
  return (parseLine(name)?.name ?? name).replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim()
}

const singular = (q: string) =>
  q
    .split(' ')
    .map((w) => (w.length >= 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ')

const stemKey = (q: string) => tokenize(normalize(q)).map(stem).join(' ')
const scoredTerms = (q: string) => tokenize(q).filter((t) => !STOP.has(t))

const toCandidate = (e: Exercise | CustomExercise): MatchCandidate => ({ ref: e.id, name: e.name })

/**
 * Pass localized exercises (useCatalog) so results show in the UI language. Matching also knows the
 * names in every other translation and the Russian input aliases, so notes match in any of them.
 */
export function createMatcher(exercises: readonly Exercise[], custom: readonly CustomExercise[], locale: Locale): Matcher {
  const searchable = exercises.map((e) => ({ ...e, aliases: [...new Set([...e.aliases, ...translatedNames(e.id), ...inputAliases(e.id)])] }))
  const index = buildIndex(searchable, locale, stem)
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const exact = new Map<string, Exercise | CustomExercise>()
  const exactStem = new Map<string, Exercise | CustomExercise>()
  for (const e of searchable) {
    const shown = byId.get(e.id)!
    for (const n of [e.name, ...e.aliases]) {
      const key = normalize(n)
      if (key && !exact.has(key)) exact.set(key, shown)
      const sk = stemKey(n)
      if (sk && !exactStem.has(sk)) exactStem.set(sk, shown)
    }
  }
  for (const c of custom) {
    exact.set(normalize(c.name), c)
    exactStem.set(stemKey(c.name), c)
  }

  const findExact = (q: string) => exact.get(normalize(q)) ?? exact.get(singular(normalize(q))) ?? exactStem.get(stemKey(q))

  const match = (name: string): MatchResult => {
    const q = cleanQuery(name)
    if (!q) return { best: null, confidence: 'none', alternatives: [] }
    const terms = scoredTerms(q)
    const scored = terms.join(' ') || q
    const customHits = custom.filter((c) => matchesQuery(c, q)).map(toCandidate)
    const hits = index.search(scored, MATCH_OPTIONS)
    const catalogHits = hits.map((h) => byId.get(h.id as number)).filter((e): e is Exercise => !!e).map(toCandidate)
    const pool = dedupe([...customHits, ...catalogHits])

    const sure = findExact(q)
    if (sure) {
      const best = toCandidate(sure)
      return { best, confidence: 'exact', alternatives: pool.filter((c) => c.ref !== best.ref).slice(0, 3) }
    }
    if (!pool.length) return { best: null, confidence: 'none', alternatives: [] }

    const wanted = new Set(terms.map(stem))
    const top = hits[0]
    const coversQuery = !!top && [...wanted].every((t) => top.queryTerms.includes(t))
    // "Farmer's walk" shares only "walk" with "Band Lateral Walk": a guess like that is worse than none.
    const covered = top ? [...wanted].filter((t) => top.queryTerms.includes(t)) : []
    if (wanted.size > 1 && covered.length <= 1 && covered.every((t) => GENERIC.has(t)) && !customHits.length) return { best: null, confidence: 'none', alternatives: pool.slice(0, 3) }
    const lead = top && hits[1] ? top.score / hits[1].score : Infinity
    const best = catalogHits[0] ?? pool[0]
    // One word is too little to be sure of ("Biceps", "Legs"): it can still be the best guess, flagged to check.
    const confidence: MatchConfidence = top && wanted.size > 1 && coversQuery && lead >= CLEAR_LEAD ? 'good' : 'weak'
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

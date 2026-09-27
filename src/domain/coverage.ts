import { availableSet, hasEquipment } from './equipment.ts'
import type { Catalog, Overrides } from './resolve.ts'
import { resolveExercise } from './resolve.ts'
import type { Exercise, Pattern, Prefs } from './schema.ts'
import { bandedGroupIds, headsOfGroup, isOptional } from './taxonomy.ts'
import type { WeekResult } from './volume.ts'

export const HEURISTIC = 'heuristic'
export const HEAD_HINT_RATIO = 0.6
export const STRENGTH_MIN_DAYS = 2

export type UntrainedItem = { group: string; optional: boolean; sourceId: string }

export type MissingPatternKind = 'horizontal_pull' | 'vertical_pull' | 'knee_flexion' | 'hip_hinge' | 'direct_rear_delt'
export type MissingPatternItem = { kind: MissingPatternKind; sourceId: string }

export type HeadHint = { group: string; head: string; value: number; groupValue: number; ratio: number; sourceId: string }

export type MainPattern = 'squat' | 'hinge' | 'horizontal_push' | 'vertical_push' | 'horizontal_pull' | 'vertical_pull'
export type StrengthItem = { pattern: MainPattern; days: number; sourceId: string }

export type Coverage = {
  trainedBanded: number
  totalBanded: number
  untrained: { required: UntrainedItem[]; optional: UntrainedItem[] }
  missingPatterns: MissingPatternItem[]
  balance: {
    /** Hard sets of push vs pull pattern exercises. */
    pushPull: { push: number; pull: number; sourceId: string }
    /** Weekly fractional sets. */
    quadHamstring: { quads: number; hamstrings: number; sourceId: string }
  }
  headHints: HeadHint[]
  /** Main patterns trained on fewer than 2 days; empty unless the goal is strength. */
  strength: StrengthItem[]
}

export const PUSH_PATTERNS: readonly Pattern[] = ['horizontal_push', 'incline_push', 'vertical_push', 'dip']
export const PULL_PATTERNS: readonly Pattern[] = ['horizontal_pull', 'vertical_pull']

export const MAIN_PATTERNS: Record<MainPattern, readonly Pattern[]> = {
  squat: ['squat'],
  hinge: ['hinge'],
  horizontal_push: ['horizontal_push', 'incline_push'],
  vertical_push: ['vertical_push'],
  horizontal_pull: ['horizontal_pull'],
  vertical_pull: ['vertical_pull'],
}

const MISSING_CHECKS: [MissingPatternKind, Pattern][] = [
  ['horizontal_pull', 'horizontal_pull'],
  ['vertical_pull', 'vertical_pull'],
  ['knee_flexion', 'knee_flexion'],
  ['hip_hinge', 'hinge'],
]

export function computeCoverage(week: WeekResult, goal: Prefs['goal']): Coverage {
  const required: UntrainedItem[] = []
  const optional: UntrainedItem[] = []
  for (const g of bandedGroupIds) {
    if (week.weekly[g] > 0) continue
    const item = { group: g, optional: isOptional(g), sourceId: HEURISTIC }
    if (item.optional) optional.push(item)
    else required.push(item)
  }

  const patterns = new Set<Pattern>()
  const patternDays = new Map<Pattern, Set<number>>()
  let push = 0
  let pull = 0
  let directRearDelt = false
  for (const { day, sets, exercise } of week.entries) {
    if (exercise.groups.rear_delt?.role === 'primary') directRearDelt = true
    const p = exercise.pattern
    if (!p) continue
    patterns.add(p)
    patternDays.set(p, (patternDays.get(p) ?? new Set()).add(day))
    if (PUSH_PATTERNS.includes(p)) push += sets
    if (PULL_PATTERNS.includes(p)) pull += sets
  }

  const missingPatterns: MissingPatternItem[] = MISSING_CHECKS.filter(([, p]) => !patterns.has(p)).map(([kind]) => ({
    kind,
    sourceId: HEURISTIC,
  }))
  if (!directRearDelt) missingPatterns.push({ kind: 'direct_rear_delt', sourceId: HEURISTIC })

  const headHints: HeadHint[] = []
  for (const [g, groupValue] of Object.entries(week.weekly)) {
    if (groupValue <= 0) continue
    for (const head of headsOfGroup(g)) {
      const value = week.heads.weekly[head] ?? 0
      const ratio = value / groupValue
      if (ratio < HEAD_HINT_RATIO) headHints.push({ group: g, head, value, groupValue, ratio, sourceId: HEURISTIC })
    }
  }

  const strength: StrengthItem[] = []
  if (goal === 'strength') {
    for (const [pattern, family] of Object.entries(MAIN_PATTERNS) as [MainPattern, readonly Pattern[]][]) {
      const days = new Set<number>()
      for (const p of family) for (const d of patternDays.get(p) ?? []) days.add(d)
      if (days.size < STRENGTH_MIN_DAYS) strength.push({ pattern, days: days.size, sourceId: HEURISTIC })
    }
  }

  return {
    trainedBanded: bandedGroupIds.length - required.length - optional.length,
    totalBanded: bandedGroupIds.length,
    untrained: { required, optional },
    missingPatterns,
    balance: {
      pushPull: { push, pull, sourceId: HEURISTIC },
      quadHamstring: { quads: week.weekly.quads ?? 0, hamstrings: week.weekly.hamstrings ?? 0, sourceId: HEURISTIC },
    },
    headHints,
    strength,
  }
}

export type Suggestion = { exercise: Exercise; emphasis: number; sourceId: string }

export type SuggestionOptions = {
  /** Rank by this head's emphasis instead of the group's average head emphasis. */
  head?: string
  overrides?: Overrides
  exclude?: Iterable<number>
}

/**
 * Active exercises the equipment allows where the group is primary (after overrides):
 * compound first, then by emphasis, then easier level, then id.
 */
export function suggestions(
  group: string,
  catalog: Catalog,
  available: Iterable<string>,
  limit = 5,
  opts: SuggestionOptions = {},
): Suggestion[] {
  const avail = availableSet(available)
  const exclude = new Set(opts.exclude ?? [])
  const heads = opts.head ? [opts.head] : headsOfGroup(group)
  const ctx = { catalog, custom: [], countingMode: 'fractional' as const, overrides: opts.overrides ?? {} }
  const out: Suggestion[] = []
  for (const ex of catalog.values()) {
    if (ex.status !== 'active' || exclude.has(ex.id) || !hasEquipment(ex, avail)) continue
    const r = resolveExercise(ex.id, ctx)
    if (r?.groups[group]?.role !== 'primary') continue
    const emphasis = heads.length ? heads.reduce((s, h) => s + (r.heads[h] ?? 0), 0) / heads.length : 1
    out.push({ exercise: ex, emphasis, sourceId: HEURISTIC })
  }
  const compound = (s: Suggestion) => (s.exercise.mechanic === 'compound' ? 0 : 1)
  out.sort(
    (a, b) =>
      compound(a) - compound(b) ||
      b.emphasis - a.emphasis ||
      a.exercise.level - b.exercise.level ||
      a.exercise.id - b.exercise.id,
  )
  return out.slice(0, limit)
}

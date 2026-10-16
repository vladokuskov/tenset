import { useMemo } from 'react'
import { sessionLabel } from '../data/localize'
import { computeCoverage, type Coverage } from '../domain/coverage'
import { emptyMix, movementMix, type MovementMix } from '../domain/movement'
import { dayFacts, weekSchedule, type GroupSchedule, type RecoveryFact } from '../domain/recovery'
import type { ResolveContext } from '../domain/resolve'
import type { Prefs, Program } from '../domain/schema'
import { estimateDay } from '../domain/session'
import { computeWeek, type WeekResult } from '../domain/volume'
import type { Locale } from '../i18n/locale'
import { useLocale } from '../i18n/messages'
import { useActiveProgram } from '../store/program.store'
import { usePrefsStore } from '../store/prefs.store'
import { weekOrder, type DayIndex } from './days'
import { useCatalog } from './useCatalog'

export type DaySummary = {
  day: DayIndex
  kind: 'rest' | 'train'
  label?: string
  note?: string
  exercises: number
  /** Sum of hard sets as entered (not fractional). */
  hardSets: number
  /** Groups with the most fractional sets that day, highest first (max 3). */
  topGroups: string[]
  /** Planned session length in minutes (nearest 5); 0 for rest or empty days. */
  estMinutes: number
  /** Hard sets per movement group; all zero on rest days. */
  mix: MovementMix
}

export type WeekView = {
  program: Program
  week: WeekResult
  coverage: Coverage
  /** Per group: trained days (E >= 2) and cyclic gaps, ordered from weekStart. */
  schedule: GroupSchedule[]
  /** Days in display order. */
  order: DayIndex[]
  /** Indexed by stored day (0 = Monday). */
  days: DaySummary[]
  /** Hard sets per movement group across the week. */
  mix: MovementMix
  /** Neutral recovery facts for one day, nearest earlier session first. */
  dayFacts: (day: DayIndex) => RecoveryFact[]
  prefs: Pick<Prefs, 'goal' | 'countingMode' | 'weekStart'>
}

export function summarize(program: Program, week: WeekResult, locale: Locale, ctx: ResolveContext): DaySummary[] {
  return program.days.map((d, day) => {
    const topGroups = Object.entries(week.daily)
      .filter(([, days]) => days[day] > 0)
      .sort((a, b) => b[1][day] - a[1][day])
      .slice(0, 3)
      .map(([g]) => g)
    return {
      day,
      kind: d.kind,
      label: sessionLabel(d.label, locale),
      note: d.note,
      exercises: d.kind === 'train' ? d.entries.length : 0,
      hardSets: d.kind === 'train' ? d.entries.reduce((s, e) => s + e.sets, 0) : 0,
      topGroups: d.kind === 'train' ? topGroups : [],
      estMinutes: estimateDay(d, ctx),
      mix: d.kind === 'train' ? movementMix(week.entries.filter((e) => e.day === day)) : emptyMix(),
    }
  })
}

/**
 * Memoized engine output for a program (the active one by default) under the current prefs.
 * Pass a program to preview something that is not stored, e.g. a decoded share link.
 */
export function useWeek(programOverride?: Program | null): WeekView | null {
  const active = useActiveProgram()
  const program = programOverride === undefined ? active : programOverride
  const { catalog } = useCatalog()
  const goal = usePrefsStore((s) => s.goal)
  const countingMode = usePrefsStore((s) => s.countingMode)
  const weekStart = usePrefsStore((s) => s.weekStart)
  const overrides = usePrefsStore((s) => s.overrides)
  const targets = usePrefsStore((s) => s.targets)
  const locale = useLocale()

  return useMemo(() => {
    if (!program) return null
    const week = computeWeek(program, { catalog, prefs: { countingMode, overrides, targets } })
    return {
      program,
      week,
      coverage: computeCoverage(week, goal),
      schedule: weekSchedule(week.daily, weekStart),
      order: weekOrder(weekStart),
      days: summarize(program, week, locale, { catalog, custom: program.custom, countingMode, overrides }),
      mix: movementMix(week.entries),
      dayFacts: (day: DayIndex) => dayFacts(week.daily, day),
      prefs: { goal, countingMode, weekStart },
    }
  }, [program, catalog, goal, countingMode, weekStart, overrides, targets, locale])
}

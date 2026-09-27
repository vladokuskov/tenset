import { useMemo } from 'react'
import { computeCoverage, type Coverage } from '../domain/coverage'
import { dayFacts, weekSchedule, type GroupSchedule, type RecoveryFact } from '../domain/recovery'
import type { Prefs, Program } from '../domain/schema'
import { computeWeek, type WeekResult } from '../domain/volume'
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
  /** Neutral recovery facts for one day, nearest earlier session first. */
  dayFacts: (day: DayIndex) => RecoveryFact[]
  prefs: Pick<Prefs, 'goal' | 'countingMode' | 'weekStart'>
}

function summarize(program: Program, week: WeekResult): DaySummary[] {
  return program.days.map((d, day) => {
    const topGroups = Object.entries(week.daily)
      .filter(([, days]) => days[day] > 0)
      .sort((a, b) => b[1][day] - a[1][day])
      .slice(0, 3)
      .map(([g]) => g)
    return {
      day,
      kind: d.kind,
      label: d.label,
      note: d.note,
      exercises: d.kind === 'train' ? d.entries.length : 0,
      hardSets: d.kind === 'train' ? d.entries.reduce((s, e) => s + e.sets, 0) : 0,
      topGroups: d.kind === 'train' ? topGroups : [],
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

  return useMemo(() => {
    if (!program) return null
    const week = computeWeek(program, { catalog, prefs: { countingMode, overrides } })
    return {
      program,
      week,
      coverage: computeCoverage(week, goal),
      schedule: weekSchedule(week.daily, weekStart),
      order: weekOrder(weekStart),
      days: summarize(program, week),
      dayFacts: (day: DayIndex) => dayFacts(week.daily, day),
      prefs: { goal, countingMode, weekStart },
    }
  }, [program, catalog, goal, countingMode, weekStart, overrides])
}

// Information only: plain facts about when each group is trained. No severity by design.

export const RECOVERY_MIN_SETS = 2

export type GroupSchedule = {
  group: string
  /** Days with E >= RECOVERY_MIN_SETS, ordered from weekStart. */
  days: number[]
  /** Cyclic gaps in days: gaps[i] runs from days[i] to the next trained day (wrapping into next week). */
  gaps: number[]
}

export type RecoveryFact = {
  group: string
  day: number
  previousDay: number
  daysEarlier: number
  /** E on previousDay. */
  sets: number
}

const trained = (days: readonly number[], d: number) => (days[d] ?? 0) >= RECOVERY_MIN_SETS

export function groupSchedule(group: string, days: readonly number[], weekStart = 0): GroupSchedule {
  const hit: number[] = []
  for (let i = 0; i < 7; i++) {
    const d = (weekStart + i) % 7
    if (trained(days, d)) hit.push(d)
  }
  const gaps = hit.map((d, i) => {
    const next = hit[(i + 1) % hit.length]
    return (next - d + 7) % 7 || 7
  })
  return { group, days: hit, gaps }
}

/** Schedules for every group trained at least once. */
export function weekSchedule(daily: Record<string, readonly number[]>, weekStart = 0): GroupSchedule[] {
  return Object.entries(daily)
    .map(([g, days]) => groupSchedule(g, days, weekStart))
    .filter((s) => s.days.length > 0)
}

/** For each group trained on `day`, the nearest earlier day (cyclic) it was also trained. */
export function dayFacts(daily: Record<string, readonly number[]>, day: number): RecoveryFact[] {
  const facts: RecoveryFact[] = []
  for (const [group, days] of Object.entries(daily)) {
    if (!trained(days, day)) continue
    for (let back = 1; back < 7; back++) {
      const prev = (day - back + 7) % 7
      if (trained(days, prev)) {
        facts.push({ group, day, previousDay: prev, daysEarlier: back, sets: days[prev] })
        break
      }
    }
  }
  return facts.sort((a, b) => a.daysEarlier - b.daysEarlier)
}

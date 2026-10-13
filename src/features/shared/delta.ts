import { formatDelta } from '../../app/format'
import { groupName } from '../../data/localize'
import { resolveExercise, type Catalog, type ResolveContext } from '../../domain/resolve'
import type { ExerciseRef, Prefs, Program } from '../../domain/schema'
import { groupIds, isBanded } from '../../domain/taxonomy'
import { computeWeek, type WeekResult } from '../../domain/volume'
import type { Locale } from '../../i18n/locale'
import { getLocale } from '../../i18n/messages'

export type GroupDelta = { group: string; from: number; to: number }

const EPS = 0.05

export function weekFor(program: Program, catalog: Catalog, prefs: Pick<Prefs, 'countingMode' | 'overrides'>): WeekResult {
  return computeWeek(program, { catalog, prefs: { countingMode: prefs.countingMode, overrides: prefs.overrides } })
}

/** Groups whose weekly sets changed, banded first, biggest change first. */
export function weekDeltas(before: WeekResult | null, after: WeekResult | null): GroupDelta[] {
  const out: GroupDelta[] = []
  for (const g of groupIds) {
    const from = before?.weekly[g] ?? 0
    const to = after?.weekly[g] ?? 0
    if (Math.abs(to - from) >= EPS) out.push({ group: g, from, to })
  }
  return out.sort(
    (a, b) =>
      Number(isBanded(b.group)) - Number(isBanded(a.group)) || Math.abs(b.to - b.from) - Math.abs(a.to - a.from),
  )
}

/** Per day, the groups whose sets changed that day. */
export function dayChanges(before: WeekResult | null, after: WeekResult | null): Record<number, string[]> {
  const out: Record<number, string[]> = {}
  for (const g of groupIds) {
    for (let d = 0; d < 7; d++) {
      const from = before?.daily[g]?.[d] ?? 0
      const to = after?.daily[g]?.[d] ?? 0
      if (Math.abs(to - from) >= EPS) (out[d] ??= []).push(g)
    }
  }
  return out
}

/** "Chest 8 → 11, Triceps 4 → 5.5" */
export function deltaText(deltas: readonly GroupDelta[], max = 2, locale: Locale = getLocale()): string {
  return deltas
    .slice(0, max)
    .map((d) => `${groupName(d.group, locale)} ${formatDelta(d.from, d.to, locale)}`)
    .join(', ')
}

/** What adding `sets` of an exercise would do to each group it counts for. */
export function addPreview(ref: ExerciseRef, sets: number, week: WeekResult, ctx: ResolveContext): GroupDelta[] {
  const r = resolveExercise(ref, ctx)
  if (!r) return []
  return Object.entries(r.groups)
    .filter(([, g]) => g.weight > 0)
    .sort((a, b) => b[1].weight - a[1].weight || Number(isBanded(b[0])) - Number(isBanded(a[0])))
    .map(([group, g]) => {
      const from = week.weekly[group] ?? 0
      return { group, from, to: from + sets * g.weight }
    })
}

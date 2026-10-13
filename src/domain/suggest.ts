import { computeCoverage, suggestions } from './coverage.ts'
import type { Catalog, Overrides } from './resolve.ts'
import type { Prefs } from './schema.ts'
import { bandedGroupIds, getGroup } from './taxonomy.ts'
import type { WeekResult } from './volume.ts'

export type GapKind = 'untrained' | 'below' | 'optional'

export type SuggestedSection = { group: string; kind: GapKind; exerciseIds: number[] }

export type SuggestOptions = {
  week: WeekResult
  goal: Prefs['goal']
  catalog: Catalog
  equipment: Iterable<string>
  overrides?: Overrides
  /** The open day: its existing muscles and label steer the order. */
  day: number
  /** The day's label in English (template labels translated back), used to read the split focus. */
  label?: string
  /** Exercises already on the day. */
  exclude?: Iterable<number>
}

const LIMITS: Record<GapKind, number> = { untrained: 3, below: 2, optional: 2 }
const KIND_ORDER: Record<GapKind, number> = { untrained: 0, below: 1, optional: 2 }

const PUSH = ['chest', 'front_delt', 'side_delt', 'triceps']
const PULL = ['lats', 'upper_back', 'rear_delt', 'biceps', 'forearms', 'upper_traps']
const areaGroups = (area: 'upper' | 'lower') => bandedGroupIds.filter((g) => getGroup(g)?.area === area)

// Checked in order; the first word found in the label wins. 'full' means no focus.
const FOCUS_WORDS: [RegExp, () => string[] | null][] = [
  [/\bfull\b/, () => null],
  [/\bupper\b/, () => areaGroups('upper')],
  [/\b(lower|legs?)\b/, () => areaGroups('lower')],
  [/\bpush\b/, () => PUSH],
  [/\bpull\b/, () => PULL],
  [/\bchest\b/, () => ['chest']],
  [/\bback\b/, () => ['lats', 'upper_back', 'rear_delt', 'upper_traps', 'lower_back']],
  [/\bshoulders?\b/, () => ['front_delt', 'side_delt', 'rear_delt', 'upper_traps']],
  [/\barms?\b/, () => ['biceps', 'triceps', 'forearms']],
]

/** Groups a day label points at; null when the label says nothing (or says full body). */
export function labelFocus(label: string | undefined): ReadonlySet<string> | null {
  const text = label?.toLowerCase() ?? ''
  for (const [re, groups] of FOCUS_WORDS) {
    if (!re.test(text)) continue
    const g = groups()
    return g ? new Set(g) : null
  }
  return null
}

const saysFull = (label: string | undefined) => /\bfull\b/.test(label?.toLowerCase() ?? '')

/**
 * How well a group fits the open day: 2 when the day already trains it or its label names it,
 * 0 when the day has a focus (from its label, else the body areas it trains) that leaves the group out.
 */
export function dayFit(week: WeekResult, day: number, label: string | undefined): (group: string) => number {
  const onDay = (g: string) => (week.daily[g]?.[day] ?? 0) > 0
  const named = labelFocus(label)
  let focus: ReadonlySet<string> | null = named
  if (!focus && !saysFull(label)) {
    const areas = new Set(bandedGroupIds.filter(onDay).map((g) => getGroup(g)?.area))
    areas.delete('core')
    areas.delete(undefined)
    if (areas.size === 1) focus = new Set(areaGroups([...areas][0] as 'upper' | 'lower'))
  }
  return (g) => {
    if (onDay(g) || named?.has(g)) return 2
    if (!focus || getGroup(g)?.area === 'core') return 1
    return focus.has(g) ? 2 : 0
  }
}

/**
 * Week gaps to suggest in the Add sheet, ordered for the open day: required groups before optional,
 * then by fit with the day, then not trained before below target, then fewest weekly sets.
 */
export function suggestedSections(opts: SuggestOptions): SuggestedSection[] {
  const { week, goal, catalog, equipment, overrides, day, label } = opts
  const { untrained } = computeCoverage(week, goal)
  const gaps: { group: string; kind: GapKind }[] = [
    ...untrained.required.map((u) => ({ group: u.group, kind: 'untrained' as const })),
    ...bandedGroupIds
      .filter((g) => (week.weekly[g] ?? 0) > 0)
      .filter((g) => {
        const band = week.bands[g]
        return band && !band.optional && (band.band === 'light' || band.band === 'moderate')
      })
      .map((g) => ({ group: g, kind: 'below' as const })),
    ...untrained.optional.map((u) => ({ group: u.group, kind: 'optional' as const })),
  ]
  const fit = dayFit(week, day, label)
  const optionalRank = (k: GapKind) => (k === 'optional' ? 1 : 0)
  gaps.sort(
    (a, b) =>
      optionalRank(a.kind) - optionalRank(b.kind) ||
      fit(b.group) - fit(a.group) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (week.weekly[a.group] ?? 0) - (week.weekly[b.group] ?? 0),
  )

  const eq = [...equipment]
  const shown = new Set<number>(opts.exclude ?? [])
  const out: SuggestedSection[] = []
  for (const { group, kind } of gaps) {
    const limit = LIMITS[kind]
    const exerciseIds = suggestions(group, catalog, eq, limit + 4, { overrides })
      .map((s) => s.exercise.id)
      .filter((id) => !shown.has(id))
      .slice(0, limit)
    exerciseIds.forEach((id) => shown.add(id))
    if (exerciseIds.length) out.push({ group, kind, exerciseIds })
  }
  return out
}

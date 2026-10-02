import type { ExerciseRef, Prefs, Program, Role } from './schema.ts'
import { resolveExercise, type Catalog, type ResolvedExercise } from './resolve.ts'
import {
  allHeadsOfGroup,
  bandSources,
  deepHeadsOf,
  groupIds,
  headsOfGroup,
  type BandEdges,
} from './taxonomy.ts'
import { resolveTarget, type Targets } from './targets.ts'
import type { TargetMode } from './schema.ts'

export const DAYS = 7
export const WEEK_INTENSITY_SETS = 30
export const DAY_INTENSITY_SETS = 10

export type BandId = 'none' | 'light' | 'moderate' | 'target' | 'high' | 'very_high'

export type BandResult = {
  band: BandId
  value: number
  edges: BandEdges
  /** The research edges; differs from edges when the user set their own range. */
  cited: BandEdges
  mode: TargetMode
  optional: boolean
  sourceIds: string[]
}

export type Contribution = {
  entryId: string
  exerciseRef: ExerciseRef
  day: number
  sets: number
  role: Role
  weight: number
  value: number
}

export type ResolvedEntry = {
  entryId: string
  day: number
  sets: number
  exercise: ResolvedExercise
}

export type EngineContext = {
  catalog: Catalog
  prefs: Pick<Prefs, 'countingMode' | 'overrides' | 'targets'>
}

export type Series = { weekly: Record<string, number>; daily: Record<string, number[]> }

export type WeekResult = {
  /** E[group][day] */
  daily: Record<string, number[]>
  /** W[group] */
  weekly: Record<string, number>
  /** Days per week, a day counting as its highest role weight for the group (1 direct, 0.5 indirect). */
  frequency: Record<string, number>
  bands: Record<string, BandResult | null>
  contributions: Record<string, Contribution[]>
  /** Raw H for every visible and deep head. */
  heads: Series
  /** What the map draws on visible heads: max(head, its deep heads). */
  shade: Series
  intensity: { groups: Series; heads: Series }
  /** Training-day entries that resolved, in day then list order. */
  entries: ResolvedEntry[]
  /** Entry ids whose exercise is missing from the catalog or program. */
  unresolved: string[]
}

const round = (x: number) => Math.round(x * 1e6) / 1e6
const zeros = () => new Array<number>(DAYS).fill(0)

export function weekIntensity(sets: number): number {
  return sets <= 0 ? 0 : Math.min(1, Math.sqrt(sets) / Math.sqrt(WEEK_INTENSITY_SETS))
}

export function dayIntensity(sets: number): number {
  return sets <= 0 ? 0 : Math.min(1, Math.sqrt(sets) / Math.sqrt(DAY_INTENSITY_SETS))
}

export function classifyBand(value: number, edges: BandEdges, optional: boolean): BandId {
  const [a, b, c, d] = edges
  if (value <= 0) return 'none'
  if (value < a) return optional ? 'moderate' : 'light'
  if (value < b) return 'moderate'
  if (value <= c) return 'target'
  if (value <= d) return 'high'
  return 'very_high'
}

/** Weekly band for a group; null for unbanded and skipped groups (value only). */
export function bandFor(groupId: string, weeklySets: number, targets?: Targets): BandResult | null {
  const { edges, cited, optional, mode } = resolveTarget(groupId, targets)
  if (!edges || !cited) return null
  const value = round(weeklySets)
  return { band: classifyBand(value, edges, optional), value, edges, cited, mode, optional, sourceIds: bandSources(groupId) }
}

export function computeWeek(program: Program, ctx: EngineContext): WeekResult {
  const resolveCtx = {
    catalog: ctx.catalog,
    custom: program.custom,
    countingMode: ctx.prefs.countingMode,
    overrides: ctx.prefs.overrides,
  }

  const daily: Record<string, number[]> = {}
  const dayMaxWeight: Record<string, number[]> = {}
  const contributions: Record<string, Contribution[]> = {}
  const headDaily: Record<string, number[]> = {}
  for (const g of groupIds) {
    daily[g] = zeros()
    dayMaxWeight[g] = zeros()
    contributions[g] = []
    for (const h of allHeadsOfGroup(g)) headDaily[h] = zeros()
  }

  const entries: ResolvedEntry[] = []
  const unresolved: string[] = []

  program.days.forEach((day, d) => {
    if (day.kind === 'rest') return
    for (const entry of day.entries) {
      const exercise = resolveExercise(entry.exerciseId, resolveCtx)
      if (!exercise) {
        unresolved.push(entry.id)
        continue
      }
      entries.push({ entryId: entry.id, day: d, sets: entry.sets, exercise })
      for (const [g, { role, weight }] of Object.entries(exercise.groups)) {
        if (weight <= 0) continue
        const value = entry.sets * weight
        daily[g][d] += value
        dayMaxWeight[g][d] = Math.max(dayMaxWeight[g][d], weight)
        contributions[g].push({ entryId: entry.id, exerciseRef: entry.exerciseId, day: d, sets: entry.sets, role, weight, value })
        for (const h of allHeadsOfGroup(g)) headDaily[h][d] += value * (exercise.heads[h] ?? 1)
      }
    }
  })

  const weekly: Record<string, number> = {}
  const frequency: Record<string, number> = {}
  const bands: Record<string, BandResult | null> = {}
  for (const g of groupIds) {
    daily[g] = daily[g].map(round)
    weekly[g] = round(daily[g].reduce((a, b) => a + b, 0))
    frequency[g] = round(dayMaxWeight[g].reduce((a, b) => a + b, 0))
    bands[g] = bandFor(g, weekly[g], ctx.prefs.targets)
  }

  const heads = seriesFromDaily(headDaily)
  const shade: Series = { weekly: {}, daily: {} }
  for (const g of groupIds) {
    for (const v of headsOfGroup(g)) {
      const deep = deepHeadsOf(v)
      shade.weekly[v] = Math.max(heads.weekly[v], ...deep.map((h) => heads.weekly[h]))
      shade.daily[v] = heads.daily[v].map((x, d) => Math.max(x, ...deep.map((h) => heads.daily[h][d])))
    }
  }

  return {
    daily,
    weekly,
    frequency,
    bands,
    contributions,
    heads,
    shade,
    intensity: { groups: intensityOf({ weekly, daily }), heads: intensityOf(shade) },
    entries,
    unresolved,
  }
}

function seriesFromDaily(daily: Record<string, number[]>): Series {
  const out: Series = { weekly: {}, daily: {} }
  for (const [k, days] of Object.entries(daily)) {
    out.daily[k] = days.map(round)
    out.weekly[k] = round(days.reduce((a, b) => a + b, 0))
  }
  return out
}

function intensityOf(s: Series): Series {
  const out: Series = { weekly: {}, daily: {} }
  for (const k of Object.keys(s.weekly)) {
    out.weekly[k] = weekIntensity(s.weekly[k])
    out.daily[k] = s.daily[k].map(dayIntensity)
  }
  return out
}

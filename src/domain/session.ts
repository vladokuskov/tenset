import { resolveExercise, type ResolveContext, type ResolvedExercise } from './resolve.ts'
import type { Day, Entry } from './schema.ts'

const SETUP_SEC = 60
const PAIR_SETUP_SEC = 120
const PAIR_SWITCH_SEC = 15
const SEC_PER_REP = 3
const FALLBACK_REPS = 10

/** Midpoint of "8-12" or a plain "10"; null for text like "AMRAP". */
export function repsMidpoint(reps: string | undefined): number | null {
  const m = reps?.trim().match(/^(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?$/)
  if (!m) return null
  const a = Number(m[1].replace(',', '.'))
  const b = m[2] ? Number(m[2].replace(',', '.')) : a
  const mid = (a + b) / 2
  return mid > 0 ? mid : null
}

/** Rest used when the entry has none: compound 120 s, isolation 75 s, custom 90 s. */
export function defaultRestSec(ex: Pick<ResolvedExercise, 'mechanic'>): number {
  return ex.mechanic === 'compound' ? 120 : ex.mechanic === 'isolation' ? 75 : 90
}

type Part = { sets: number; work: number; rest: number }

function part(entry: Entry, ex: ResolvedExercise): Part {
  const mid = repsMidpoint(entry.reps) ?? repsMidpoint(ex.defaultReps) ?? FALLBACK_REPS
  const once = ex.unit === 'seconds' ? mid : mid * SEC_PER_REP
  return {
    sets: entry.sets,
    work: ex.laterality === 'unilateral' ? once * 2 : once,
    rest: entry.restSec ?? defaultRestSec(ex),
  }
}

const single = (p: Part) => SETUP_SEC + p.sets * p.work + (p.sets - 1) * p.rest

function pair(a: Part, b: Part): number {
  const rounds = Math.max(a.sets, b.sets)
  return PAIR_SETUP_SEC + a.sets * a.work + b.sets * b.work + (rounds - 1) * (PAIR_SWITCH_SEC + Math.max(a.rest, b.rest))
}

/** Planned session length in seconds; supersets share setup and rest. Unknown exercises are skipped. */
export function estimateSeconds(day: Day, ctx: ResolveContext): number {
  if (day.kind === 'rest') return 0
  const parts = day.entries.map((e) => {
    const ex = resolveExercise(e.exerciseId, ctx)
    return ex ? part(e, ex) : null
  })
  let total = 0
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p) continue
    const next = parts[i + 1]
    if (next && day.entries[i + 1].withPrev) {
      total += pair(p, next)
      i++
    } else {
      total += single(p)
    }
  }
  return total
}

/** Minutes rounded to the nearest 5, at least 5 when anything counts; 0 for rest or empty days. */
export function estimateDay(day: Day, ctx: ResolveContext): number {
  const sec = estimateSeconds(day, ctx)
  if (sec <= 0) return 0
  return Math.max(5, Math.round(sec / 300) * 5)
}

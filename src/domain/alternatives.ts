import { availableSet, hasEquipment } from './equipment.ts'
import { resolveExercise, type ResolveContext } from './resolve.ts'
import type { CustomExercise, Exercise } from './schema.ts'
import { allHeadsOfGroup } from './taxonomy.ts'

type AnyExercise = Exercise | CustomExercise

export type Alternative = { exercise: Exercise; available: boolean }
export type Ranked<T extends AnyExercise> = { exercise: T; available: boolean; overlap: number }

const isCatalog = (e: AnyExercise): e is Exercise => typeof e.id === 'number'

/** Head emphasis weighted by the role of its group, after the user's overrides and counting mode. */
export function headVector(e: AnyExercise, ctx: ResolveContext): Map<string, number> {
  const v = new Map<string, number>()
  const r = resolveExercise(e.id, ctx)
  if (!r) return v
  for (const [group, { weight }] of Object.entries(r.groups)) {
    if (weight <= 0) continue
    const heads = allHeadsOfGroup(group)
    if (heads.length === 0) v.set(`group:${group}`, weight)
    for (const h of heads) v.set(h, (r.heads[h] ?? 1) * weight)
  }
  return v
}

/** Cosine similarity of two head vectors, 0 to 1. */
export function headOverlap(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (const [k, x] of a) {
    na += x * x
    dot += x * (b.get(k) ?? 0)
  }
  for (const x of b.values()) nb += x * x
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

const levelOf = (e: AnyExercise) => (isCatalog(e) ? e.level : null)

/**
 * Ranks swap candidates: equipment you have first, then the curated list order, then head overlap,
 * then closer level, then id. Filtering which candidates qualify is up to the caller.
 */
export function rankAlternatives<T extends AnyExercise>(
  target: AnyExercise,
  candidates: readonly T[],
  ctx: ResolveContext,
  available: Iterable<string>,
): Ranked<T>[] {
  const avail = availableSet(available)
  const curated = new Map((isCatalog(target) ? target.alternatives : []).map((id, i) => [id, i]))
  const own = headVector(target, ctx)
  const level = levelOf(target)
  const scored = candidates.map((e) => ({
    exercise: e,
    available: hasEquipment(e, avail),
    overlap: headOverlap(own, headVector(e, ctx)),
    rank: isCatalog(e) ? (curated.get(e.id) ?? Infinity) : Infinity,
    distance: level === null ? 0 : Math.abs((levelOf(e) ?? level) - level),
  }))
  scored.sort(
    (a, b) =>
      Number(b.available) - Number(a.available) ||
      a.rank - b.rank ||
      b.overlap - a.overlap ||
      a.distance - b.distance ||
      String(a.exercise.id).localeCompare(String(b.exercise.id), 'en', { numeric: true }),
  )
  return scored.map(({ exercise, available, overlap }) => ({ exercise, available, overlap }))
}

const primaries = (e: Exercise) => Object.keys(e.groups).filter((g) => e.groups[g] === 'primary')

/** Same movement pattern and at least one shared primary group, plus the record's own list. */
export function alternativesFor(
  exercise: Exercise,
  exercises: readonly Exercise[],
  available: Iterable<string>,
  ctx: ResolveContext,
  limit = 6,
): Alternative[] {
  const own = new Set(primaries(exercise))
  const listed = new Set(exercise.alternatives)
  const candidates = exercises.filter(
    (e) =>
      e.id !== exercise.id &&
      e.status === 'active' &&
      (listed.has(e.id) || (e.pattern === exercise.pattern && primaries(e).some((g) => own.has(g)))),
  )
  return rankAlternatives(exercise, candidates, ctx, available)
    .slice(0, limit)
    .map(({ exercise, available }) => ({ exercise, available }))
}

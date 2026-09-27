import { hasEquipment } from '../../domain/equipment'
import type { Exercise } from '../../domain/schema'

export type Alternative = { exercise: Exercise; available: boolean }

const primaries = (e: Exercise) => Object.keys(e.groups).filter((g) => e.groups[g] === 'primary')

/**
 * Same movement pattern and at least one shared primary group (plus the record's own list).
 * Exercises your equipment allows come first, then the curated list order, then closer matches.
 */
export function alternativesFor(
  exercise: Exercise,
  exercises: readonly Exercise[],
  available: Iterable<string>,
  limit = 6,
): Alternative[] {
  const avail = new Set(available)
  const own = new Set(primaries(exercise))
  const listed = new Map(exercise.alternatives.map((id, i) => [id, i]))
  const scored = exercises
    .filter((e) => e.id !== exercise.id && e.status === 'active')
    .map((e) => {
      const shared = primaries(e).filter((g) => own.has(g)).length
      return { e, shared, rank: listed.get(e.id) ?? Infinity }
    })
    .filter(({ e, shared, rank }) => rank !== Infinity || (e.pattern === exercise.pattern && shared > 0))
    .map((s) => ({ ...s, available: hasEquipment(s.e, avail) }))

  scored.sort(
    (a, b) =>
      Number(b.available) - Number(a.available) ||
      a.rank - b.rank ||
      b.shared - a.shared ||
      Math.abs(a.e.level - exercise.level) - Math.abs(b.e.level - exercise.level) ||
      a.e.id - b.e.id,
  )
  return scored.slice(0, limit).map(({ e, available }) => ({ exercise: e, available }))
}

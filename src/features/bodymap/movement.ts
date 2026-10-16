import { MOVEMENT_GROUPS, movementGroupOf, type MovementKey } from '../../domain/movement'
import type { ExerciseRef, Pattern } from '../../domain/schema'

export type MovementRow = { key: MovementKey; sets: number; exercises: number }

type Entry = { day: number; sets: number; exercise: { ref: ExerciseRef; pattern: Pattern | null } }

/** Sets and distinct exercises per movement group for the week or one day. All six groups, plus "other" when it has sets. */
export function movementRows(entries: Iterable<Entry>, day: number | null = null): MovementRow[] {
  const sets = new Map<MovementKey, number>()
  const refs = new Map<MovementKey, Set<ExerciseRef>>()
  for (const e of entries) {
    if (day !== null && e.day !== day) continue
    const key = movementGroupOf(e.exercise.pattern)
    sets.set(key, (sets.get(key) ?? 0) + e.sets)
    if (!refs.has(key)) refs.set(key, new Set())
    refs.get(key)!.add(e.exercise.ref)
  }
  const keys: MovementKey[] = [...MOVEMENT_GROUPS.map((g) => g.id), ...(sets.get('other') ? (['other'] as const) : [])]
  return keys.map((key) => ({ key, sets: sets.get(key) ?? 0, exercises: refs.get(key)?.size ?? 0 }))
}

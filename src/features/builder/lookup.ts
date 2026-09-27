import type { Catalog } from '../../domain/resolve'
import type { Entry, ExerciseRef, Program } from '../../domain/schema'
import type { AnyExercise } from './labels'

export function exerciseFor(ref: ExerciseRef, catalog: Catalog, program: Program | null | undefined): AnyExercise | null {
  if (typeof ref === 'number') return catalog.get(ref) ?? null
  return program?.custom.find((c) => c.id === ref) ?? null
}

export function findEntry(program: Program | null | undefined, entryId: string | undefined): { day: number; index: number; entry: Entry } | null {
  if (!program || !entryId) return null
  for (let day = 0; day < program.days.length; day++) {
    const index = program.days[day].entries.findIndex((e) => e.id === entryId)
    if (index >= 0) return { day, index, entry: program.days[day].entries[index] }
  }
  return null
}

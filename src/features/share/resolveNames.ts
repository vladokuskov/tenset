import type { Catalog } from '../../domain/resolve'
import type { ExerciseRef, Program } from '../../domain/schema'

/** Display name for an entry; unknown catalog ids (a newer app made the link) still read sensibly. */
export function exerciseName(ref: ExerciseRef, catalog: Catalog, custom: Program['custom']): string {
  if (typeof ref === 'string') return custom.find((c) => c.id === ref)?.name ?? 'Custom exercise'
  return catalog.get(ref)?.name ?? `Exercise #${ref}`
}

export function isKnown(ref: ExerciseRef, catalog: Catalog, custom: Program['custom']): boolean {
  return typeof ref === 'string' ? custom.some((c) => c.id === ref) : catalog.has(ref)
}

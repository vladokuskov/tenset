import type { Catalog } from '../../domain/resolve'
import type { ExerciseRef, Program } from '../../domain/schema'
import type { Locale } from '../../i18n/locale'
import { getLocale } from '../../i18n/messages'
import { shareMessages } from './messages'

/** Display name for an entry; unknown catalog ids (a newer app made the link) still read sensibly. */
export function exerciseName(ref: ExerciseRef, catalog: Catalog, custom: Program['custom'], locale: Locale = getLocale()): string {
  const m = shareMessages[locale]
  if (typeof ref === 'string') return custom.find((c) => c.id === ref)?.name ?? m.customExercise
  return catalog.get(ref)?.name ?? m.exerciseNumber(ref)
}

export function isKnown(ref: ExerciseRef, catalog: Catalog, custom: Program['custom']): boolean {
  return typeof ref === 'string' ? custom.some((c) => c.id === ref) : catalog.has(ref)
}

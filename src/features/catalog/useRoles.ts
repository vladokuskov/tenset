import { useMemo } from 'react'
import type { Role } from '../../domain/schema'
import { usePrefsStore } from '../../store/prefs.store'
import type { CardExercise } from './media'
import { applyOverride, isCustomized, type GroupOverride } from './roles'

const NO_OVERRIDES: GroupOverride = {}

/** Group roles after the user's "Edit how this counts" overrides. */
export function useRoles(exercise: CardExercise): Record<string, Role> {
  const override = usePrefsStore((s) => s.overrides[String(exercise.id)] ?? NO_OVERRIDES)
  return useMemo(() => applyOverride(exercise.groups, override), [exercise.groups, override])
}

/** Whether the user changed how this exercise counts. */
export function useIsCustomized(exercise: CardExercise): boolean {
  return usePrefsStore((s) => isCustomized(exercise.groups, s.overrides[String(exercise.id)]))
}

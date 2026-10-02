import type { DayIndex } from '../../app/days'
import { toastWithUndo } from '../../app/undo'
import type { Exercise, Prefs } from '../../domain/schema'
import { getMessages } from '../../i18n/messages'
import { programStore } from '../../store/program.store'
import { catalogMessages } from './messages'

export function defaultReps(exercise: Exercise, goal: Prefs['goal']): string {
  return goal === 'strength' && exercise.defaults.strengthReps ? exercise.defaults.strengthReps : exercise.defaults.reps
}

/** Adds one exercise to several days as a single undoable change. */
export function addToDays(exercise: Exercise, days: readonly DayIndex[], goal: Prefs['goal'], weekStart: DayIndex): void {
  if (!days.length) return
  const before = programStore.getState()
  const { addEntries } = before
  for (const d of days) addEntries(d, [exercise.id], exercise.defaults.sets, defaultReps(exercise, goal))
  if (days.length > 1) {
    programStore.setState({ lastChange: { action: 'addEntries', programs: before.programs, activeId: before.activeId } })
  }
  toastWithUndo(getMessages(catalogMessages).added(exercise.name, days, weekStart))
}

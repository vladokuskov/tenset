import type { CustomExercise, Exercise, Prefs } from '../../domain/schema'
import { getGroup } from '../../domain/taxonomy'

export const REPS_PRESETS = ['3-5', '6-8', '8-12', '10-15', '15-20', '20-30'] as const
export const SECONDS_PRESETS = ['15-30', '30-45', '30-60', '45-60'] as const

export function groupName(group: string): string {
  return getGroup(group)?.name ?? group
}

export type AnyExercise = Exercise | CustomExercise

export function isCustom(e: AnyExercise): e is CustomExercise {
  return typeof e.id === 'string'
}

/** Second line of an exercise row: primary muscles, flagged when the mapping is the user's own. */
export function rowMeta(e: AnyExercise, primaries: readonly string[]): string {
  const muscles = primaries.join(', ') || 'No muscles mapped'
  return isCustom(e) ? `Custom, your mapping · ${muscles}` : muscles
}

export function unitOf(e: AnyExercise): 'reps' | 'seconds' {
  return isCustom(e) ? 'reps' : e.unit
}

export function defaultSets(e: AnyExercise): number {
  return isCustom(e) ? 3 : e.defaults.sets
}

export function defaultReps(e: AnyExercise, goal: Prefs['goal']): string | undefined {
  if (isCustom(e)) return undefined
  return goal === 'strength' ? (e.defaults.strengthReps ?? e.defaults.reps) : e.defaults.reps
}

/** "8-12 reps", "30-45 s". */
export function repsText(reps: string | undefined, unit: 'reps' | 'seconds'): string {
  if (!reps) return unit === 'seconds' ? 'Time' : 'Reps'
  return unit === 'seconds' ? `${reps} s` : `${reps} reps`
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every query word must prefix some word of the name, aliases or family. */
export function matchesQuery(e: AnyExercise, query: string): boolean {
  const q = normalize(query)
  if (!q) return true
  const hay = normalize([e.name, ...(isCustom(e) ? [] : [...e.aliases, e.family])].join(' '))
  const words = hay.split(' ')
  return q.split(' ').every((t) => words.some((w) => w.startsWith(t)) || hay.includes(t))
}

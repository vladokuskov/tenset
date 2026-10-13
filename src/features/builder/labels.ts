import type { CustomExercise, Entry, Exercise, Prefs } from '../../domain/schema'
import { groupName } from '../../data/localize'
import type { Locale } from '../../i18n/locale'
import { getLocale } from '../../i18n/messages'
import { builderMessages } from './messages'

export const REPS_PRESETS = ['3-5', '6-8', '8-12', '10-15', '15-20', '20-30'] as const
export const SECONDS_PRESETS = ['15-30', '30-45', '30-60', '45-60'] as const

export { groupName }

export type AnyExercise = Exercise | CustomExercise

export function isCustom(e: AnyExercise): e is CustomExercise {
  return typeof e.id === 'string'
}

/** Second line of an exercise row: primary muscles, flagged when the mapping is the user's own. */
export function rowMeta(e: AnyExercise, primaries: readonly string[], locale: Locale = getLocale()): string {
  const m = builderMessages[locale]
  const muscles = primaries.join(', ') || m.noMusclesMapped
  return isCustom(e) ? m.customMeta(muscles) : muscles
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
export function repsText(reps: string | undefined, unit: 'reps' | 'seconds', locale: Locale = getLocale()): string {
  const m = builderMessages[locale]
  if (!reps) return unit === 'seconds' ? m.timeEmpty : m.repsEmpty
  // A pasted time target ("45s") reads as time whatever the exercise counts in.
  const time = /^(\d+(?:-\d+)?)s$/.exec(reps)
  if (time) return m.seconds(time[1])
  return unit === 'seconds' ? m.seconds(reps) : m.reps(reps)
}

/** Lowercase letters and digits of any script; apostrophes fold to one form so "мʼяз" matches "м'яз". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ʼ’'`]/g, 'ʼ')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}ʼ ]+/gu, ' ')
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

export type SupersetLabel = { letter: string; position: 1 | 2; label: string }

/** A1/A2, B1/B2... by pair order within the day; solo entries get null. */
export function supersetLabels(entries: readonly Pick<Entry, 'withPrev'>[]): (SupersetLabel | null)[] {
  const out: (SupersetLabel | null)[] = entries.map(() => null)
  let pairs = 0
  entries.forEach((e, i) => {
    if (!e.withPrev || i === 0 || out[i - 1]) return
    const letter = pairs < 26 ? String.fromCharCode(65 + pairs) : String(pairs + 1)
    pairs++
    out[i - 1] = { letter, position: 1, label: `${letter}1` }
    out[i] = { letter, position: 2, label: `${letter}2` }
  })
  return out
}

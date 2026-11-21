import { movementGroupOf, type MovementKey } from '../../domain/movement'
import type { CustomExercise, Entry, Exercise } from '../../domain/schema'
import type { Locale } from '../../i18n/locale'
import { getLocale } from '../../i18n/messages'
import { sharedMessages } from './messages'

export type AnyExercise = Exercise | CustomExercise

export function isCustom(e: AnyExercise): e is CustomExercise {
  return typeof e.id === 'string'
}

/** Second line of an exercise row: primary muscles, flagged when the mapping is the user's own. */
export function rowMeta(e: AnyExercise, primaries: readonly string[], locale: Locale = getLocale()): string {
  const m = sharedMessages[locale]
  const muscles = primaries.join(', ') || m.noMusclesMapped
  return isCustom(e) ? m.customMeta(muscles) : muscles
}

/** Movement group for the exercise's color; custom exercises (no pattern) and unknown ids are "other". */
export const groupOf = (e: AnyExercise | null): MovementKey => (e && !isCustom(e) ? movementGroupOf(e.pattern) : 'other')

/** "8-12 reps", "30-45 s". */
export function repsText(reps: string | undefined, unit: 'reps' | 'seconds', locale: Locale = getLocale()): string {
  const m = sharedMessages[locale]
  if (!reps) return unit === 'seconds' ? m.timeEmpty : m.repsEmpty
  const time = timeTarget(reps)
  if (time) return m.seconds(time)
  return unit === 'seconds' ? m.seconds(reps) : m.reps(reps)
}

/** A pasted time target ("45s") reads as time whatever the exercise counts in. */
function timeTarget(reps: string): string | undefined {
  return /^(\d+(?:-\d+)?)s$/.exec(reps)?.[1]
}

/** Reps as stored, with a time target ("45s") written in the locale ("45 с"). */
export function localReps(reps: string | undefined, locale: Locale = getLocale()): string | undefined {
  const time = reps && timeTarget(reps)
  return time ? sharedMessages[locale].seconds(time) : reps
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

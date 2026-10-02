import { dayName, type DayIndex } from '../../app/days'
import { formatRest, formatRir } from '../../app/format'
import type { Catalog } from '../../domain/resolve'
import type { Entry, Program } from '../../domain/schema'
import type { Locale } from '../../i18n/locale'
import { builderMessages } from '../builder/messages'
import { supersetLabels } from '../builder/labels'
import { exerciseName } from '../share/resolveNames'
import { exportMessages } from './messages'

export type EntryText = {
  /** A1, A2... for supersets. */
  marker?: string
  name: string
  /** "3 × 6-8", "rest 2 min", "RIR 2". */
  parts: string[]
}

/** Sets and reps, rest and RIR of one entry as short phrases. */
export function entryParts(e: Pick<Entry, 'sets' | 'reps' | 'restSec' | 'rir'>, unit: 'reps' | 'seconds', locale: Locale): string[] {
  const m = exportMessages[locale]
  const reps = e.reps && unit === 'seconds' ? builderMessages[locale].seconds(e.reps) : e.reps
  const parts = [m.paste.setsReps(e.sets, reps)]
  if (e.restSec !== undefined) parts.push(m.restPart(formatRest(e.restSec, locale)))
  if (e.rir !== undefined) parts.push(formatRir(e.rir, locale))
  return parts
}

/** The day's exercises as text, in order; empty for rest days. */
export function dayEntries(program: Program, day: DayIndex, catalog: Catalog, locale: Locale): EntryText[] {
  const d = program.days[day]
  if (d.kind !== 'train') return []
  const pairs = supersetLabels(d.entries)
  return d.entries.map((e, i) => {
    const unit = typeof e.exerciseId === 'number' ? (catalog.get(e.exerciseId)?.unit ?? 'reps') : 'reps'
    return {
      marker: pairs[i]?.label,
      name: exerciseName(e.exerciseId, catalog, program.custom, locale),
      parts: entryParts(e, unit, locale),
    }
  })
}

/** "Monday · Push", or the weekday alone. */
export function dayTitle(day: DayIndex, label: string | undefined, locale: Locale): string {
  const name = dayName(day, 'long', locale)
  return label ? `${name} · ${label}` : name
}

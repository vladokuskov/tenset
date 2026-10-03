import { APP_NAME } from '../../app/brand'
import { daySlug, todayIndex, weekOrder, type DayIndex } from '../../app/days'
import type { DaySummary } from '../../app/useWeek'
import type { Catalog } from '../../domain/resolve'
import type { Program } from '../../domain/schema'
import type { Locale } from '../../i18n/locale'
import { exportMessages } from './messages'
import { dayEntries, dayTitle } from './planText'

export type IcsEvent = {
  day: DayIndex
  summary: string
  description: string
  /** Planned session length; anything below 15 becomes 15. */
  minutes: number
}

export type IcsInput = {
  programId: string
  events: readonly IcsEvent[]
  /** Local start time "HH:MM". */
  time: string
  /** "Today", injectable for tests. */
  now?: Date
}

export const DEFAULT_TIME = '18:00'
export const MIN_MINUTES = 15
const CRLF = '\r\n'
const encoder = new TextEncoder()

/** TEXT value escaping (RFC 5545 3.3.11). */
export function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Folds a content line at 75 octets; continuation lines start with one space and never split a character. */
export function foldLine(line: string): string {
  const out: string[] = []
  let current = ''
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    const n = encoder.encode(ch).length
    if (bytes + n > limit) {
      out.push(current)
      current = ''
      bytes = 0
      limit = 74
    }
    current += ch
    bytes += n
  }
  out.push(current)
  return out.join(`${CRLF} `)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Floating local date-time: no TZID, no Z. */
export function floating(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function parseTime(time: string): { h: number; m: number } {
  const match = /^(\d{1,2}):(\d{2})/.exec(time)
  const h = match ? Number(match[1]) : 18
  const m = match ? Number(match[2]) : 0
  return h < 24 && m < 60 ? { h, m } : { h: 18, m: 0 }
}

/** Next date on that weekday (0 = Monday) at the given time; today counts. */
export function nextOccurrence(day: DayIndex, time: string, now: Date): Date {
  const { h, m } = parseTime(time)
  const offset = (day - todayIndex(now) + 7) % 7
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, m)
}

export function eventUid(programId: string, day: DayIndex): string {
  return `${programId}-${daySlug(day)}@tenset`
}

/** A VCALENDAR with one weekly VEVENT per given day. */
export function buildIcs({ programId, events, time, now = new Date() }: IcsInput): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${APP_NAME}//Weekly plan//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  for (const e of events) {
    const start = nextOccurrence(e.day, time, now)
    const end = new Date(start.getTime() + Math.max(MIN_MINUTES, Math.round(e.minutes) || 0) * 60_000)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${eventUid(programId, e.day)}`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART:${floating(start)}`,
      `DTEND:${floating(end)}`,
      'RRULE:FREQ=WEEKLY',
      `SUMMARY:${escapeText(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join(CRLF) + CRLF
}

export const ICS_FILE_NAME = 'gym-plan.ics'

/** One event per training day that has exercises, in display order. */
export function planEvents(
  program: Program,
  days: readonly Pick<DaySummary, 'kind' | 'label' | 'estMinutes'>[],
  catalog: Catalog,
  locale: Locale,
  weekStart: DayIndex = 0,
): IcsEvent[] {
  const m = exportMessages[locale].calendar
  return weekOrder(weekStart).flatMap((day) => {
    const entries = dayEntries(program, day, catalog, locale)
    if (days[day].kind !== 'train' || entries.length === 0) return []
    const lines = entries.map((e) => [e.marker, e.name, e.parts.join(', ')].filter(Boolean).join(' '))
    const note = program.days[day].note
    return [
      {
        day,
        summary: m.summary(days[day].label ?? dayTitle(day, undefined, locale)),
        description: [...lines, ...(note ? [m.note(note)] : [])].join('\n'),
        minutes: days[day].estMinutes,
      },
    ]
  })
}

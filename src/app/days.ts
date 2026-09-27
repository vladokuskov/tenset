import type { z } from 'zod'
import type { DayIndex as DayIndexSchema } from '../domain/schema'

/** 0 = Monday ... 6 = Sunday, as stored. Display order comes from prefs.weekStart. */
export type DayIndex = z.infer<typeof DayIndexSchema>

export const DAY_SLUGS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type DaySlug = (typeof DAY_SLUGS)[number]

export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
export const DAY_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

export function isDaySlug(value: unknown): value is DaySlug {
  return typeof value === 'string' && (DAY_SLUGS as readonly string[]).includes(value)
}

export function dayFromSlug(slug: DaySlug): DayIndex {
  return DAY_SLUGS.indexOf(slug)
}

export function daySlug(day: DayIndex): DaySlug {
  return DAY_SLUGS[((day % 7) + 7) % 7]
}

export function dayName(day: DayIndex, style: 'short' | 'long' | 'letter' = 'short'): string {
  const i = ((day % 7) + 7) % 7
  return style === 'long' ? DAY_LONG[i] : style === 'letter' ? DAY_LETTER[i] : DAY_SHORT[i]
}

/** The seven days in display order, starting at weekStart. */
export function weekOrder(weekStart: DayIndex = 0): DayIndex[] {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7)
}

/** Position of a day in the displayed week (0 = first column). */
export function displayPosition(day: DayIndex, weekStart: DayIndex = 0): number {
  return (day - weekStart + 7) % 7
}

/** Unique, valid days sorted in display order. */
export function sortDays(days: readonly DayIndex[], weekStart: DayIndex = 0): DayIndex[] {
  return [...new Set(days)]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => displayPosition(a, weekStart) - displayPosition(b, weekStart))
}

/** "Mon, Thu, Sat" in display order. */
export function formatDayList(days: readonly DayIndex[], weekStart: DayIndex = 0, style: 'short' | 'long' = 'short'): string {
  return sortDays(days, weekStart)
    .map((d) => dayName(d, style))
    .join(', ')
}

export function todayIndex(date: Date = new Date()): DayIndex {
  return (date.getDay() + 6) % 7
}

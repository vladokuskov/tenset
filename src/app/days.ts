import type { z } from 'zod'
import type { DayIndex as DayIndexSchema } from '../domain/schema'
import type { Locale } from '../i18n/locale'
import { getLocale } from '../i18n/messages'

/** 0 = Monday ... 6 = Sunday, as stored. Display order comes from prefs.weekStart. */
export type DayIndex = z.infer<typeof DayIndexSchema>

export const DAY_SLUGS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type DaySlug = (typeof DAY_SLUGS)[number]

/**
 * `on` reads "on Monday" / "у понеділок"; `to` reads "to Monday" / "на понеділок";
 * `from` reads "from Monday" / "з понеділка". Use them inside sentences instead of joining words.
 */
export type DayStyle = 'short' | 'long' | 'letter' | 'on' | 'to' | 'from'

const NAMES: Record<Locale, Record<DayStyle, readonly string[]>> = {
  en: {
    short: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    long: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    letter: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
    on: ['on Monday', 'on Tuesday', 'on Wednesday', 'on Thursday', 'on Friday', 'on Saturday', 'on Sunday'],
    to: ['to Monday', 'to Tuesday', 'to Wednesday', 'to Thursday', 'to Friday', 'to Saturday', 'to Sunday'],
    from: ['from Monday', 'from Tuesday', 'from Wednesday', 'from Thursday', 'from Friday', 'from Saturday', 'from Sunday'],
  },
  uk: {
    short: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'],
    long: ['Понеділок', 'Вівторок', 'Середа', 'Четвер', 'Пʼятниця', 'Субота', 'Неділя'],
    letter: ['П', 'В', 'С', 'Ч', 'П', 'С', 'Н'],
    on: ['у понеділок', 'у вівторок', 'у середу', 'у четвер', 'у пʼятницю', 'у суботу', 'у неділю'],
    to: ['на понеділок', 'на вівторок', 'на середу', 'на четвер', 'на пʼятницю', 'на суботу', 'на неділю'],
    from: ['з понеділка', 'з вівторка', 'із середи', 'з четверга', 'з пʼятниці', 'із суботи', 'з неділі'],
  },
}

export function isDaySlug(value: unknown): value is DaySlug {
  return typeof value === 'string' && (DAY_SLUGS as readonly string[]).includes(value)
}

export function dayFromSlug(slug: DaySlug): DayIndex {
  return DAY_SLUGS.indexOf(slug)
}

export function daySlug(day: DayIndex): DaySlug {
  return DAY_SLUGS[((day % 7) + 7) % 7]
}

export function dayName(day: DayIndex, style: DayStyle = 'short', locale: Locale = getLocale()): string {
  return NAMES[locale][style][((day % 7) + 7) % 7]
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
export function formatDayList(
  days: readonly DayIndex[],
  weekStart: DayIndex = 0,
  style: 'short' | 'long' = 'short',
  locale: Locale = getLocale(),
): string {
  return sortDays(days, weekStart)
    .map((d) => dayName(d, style, locale))
    .join(', ')
}

export function todayIndex(date: Date = new Date()): DayIndex {
  return (date.getDay() + 6) % 7
}

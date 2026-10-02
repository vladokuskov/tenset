import { common } from '../i18n/common.ts'
import { numberFormat } from '../i18n/format.ts'
import type { Locale } from '../i18n/locale.ts'
import { getLocale } from '../i18n/messages.ts'

/** Fractional set counts: 8 -> "8", 7.5 -> "7.5" ("7,5" in Ukrainian), 2.25 -> "2.3". */
export function formatSets(value: number, locale: Locale = getLocale()): string {
  const v = Math.round(value * 10) / 10
  return numberFormat(locale, { maximumFractionDigits: 1 }).format(v === 0 ? 0 : v)
}

/** "1 set", "7.5 sets". */
export function setsLabel(value: number, locale: Locale = getLocale()): string {
  return common[locale].sets(value)
}

/** Role weights always show one decimal so the math reads evenly: "1.0", "0.5". */
export function formatWeight(weight: number, locale: Locale = getLocale()): string {
  return numberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(weight)
}

/** Contribution math: "3 × 1.0 = 3". */
export function formatMath(sets: number, weight: number, value = sets * weight, locale: Locale = getLocale()): string {
  return `${sets} × ${formatWeight(weight, locale)} = ${formatSets(value, locale)}`
}

/** Before and after a change: "8 → 11". */
export function formatDelta(from: number, to: number, locale: Locale = getLocale()): string {
  return `${formatSets(from, locale)} → ${formatSets(to, locale)}`
}

/** Joins short facts with a middle dot, skipping empty parts: "5 exercises · 17 sets". */
export function joinMeta(parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ')
}

export function formatDaySummary(exercises: number, hardSets: number, locale: Locale = getLocale()): string {
  const m = common[locale]
  if (exercises === 0) return m.noExercisesYet
  return joinMeta([m.exercises(exercises), m.sets(hardSets)])
}

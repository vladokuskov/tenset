import type { Prefs } from '../domain/schema'
import type { BandEdges } from '../domain/taxonomy'
import type { BandId, BandResult } from '../domain/volume'
import type { Locale } from '../i18n/locale'
import { getLocale } from '../i18n/messages'
import { appMessages } from './messages'

export type GoalId = Prefs['goal']

/** A band as the copy names it. Optional groups have no "light": below their first edge they read "some sets". */
export type DisplayBand = BandId | 'some'

export const BAND_ORDER: readonly BandId[] = ['none', 'light', 'moderate', 'target', 'high', 'very_high']

export type BandCopyOptions = { goal?: GoalId; personal?: boolean }

/** True when the user set their own range for the group. */
export const isPersonal = (result: Pick<BandResult, 'mode'>) => result.mode !== 'normal'

// The engine files optional groups under their first edge as moderate; the copy keeps that apart.
export function displayBand(result: Pick<BandResult, 'band' | 'value' | 'edges' | 'optional'>): DisplayBand {
  if (!result.optional) return result.band
  if (result.band === 'light' || (result.value > 0 && result.value < result.edges[0])) return 'some'
  return result.band
}

/** Pill text. Never "optimal", "under" or "maintenance". */
export function bandLabel(band: DisplayBand, { goal }: BandCopyOptions = {}, locale: Locale = getLocale()): string {
  const m = appMessages[locale].band
  return band === 'moderate' && goal === 'general' ? m.moderateGeneral : m[band]
}

export function bandLabelFor(result: BandResult, goal?: GoalId, locale: Locale = getLocale()): string {
  return bandLabel(displayBand(result), { goal }, locale)
}

/** "target 10-20" (optional groups carry their own edges, e.g. "target 6-16"); "your range 15-25" when personal. */
export function targetText(edges: BandEdges, { personal }: { personal?: boolean } = {}, locale: Locale = getLocale()): string {
  const m = appMessages[locale]
  return (personal ? m.yourRangeText : m.targetText)(edges[1], edges[2])
}

export function bandTargetText(result: BandResult, locale: Locale = getLocale()): string {
  return targetText(result.edges, { personal: isPersonal(result) }, locale)
}

/** "Research range: 10-20 sets a week. You set your own." */
export function citedRangeText(cited: BandEdges, locale: Locale = getLocale()): string {
  return appMessages[locale].citedRange(cited[1], cited[2])
}

/** Weekly set range a band covers, for legends and the "why?" popover. */
export function bandRange(band: DisplayBand, edges: BandEdges, locale: Locale = getLocale()): string {
  const m = appMessages[locale].range
  if (band === 'none') return m.none
  return m[band === 'some' ? 'light' : band](edges)
}

/** One plain sentence explaining a band. Neutral: no warnings, no advice to cut back. */
export function bandExplanation(band: DisplayBand, edges: BandEdges, { goal, personal }: BandCopyOptions = {}, locale: Locale = getLocale()): string {
  const m = appMessages[locale].explain
  if (band === 'none') return m.none
  if (band === 'target' && personal) return m.targetPersonal(edges)
  return m[band === 'moderate' && goal === 'general' ? 'moderateGeneral' : band](edges)
}

export function bandExplanationFor(result: BandResult, goal?: GoalId, locale: Locale = getLocale()): string {
  return bandExplanation(displayBand(result), result.edges, { goal, personal: isPersonal(result) }, locale)
}

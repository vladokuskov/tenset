import { targetText } from '../../app/bands'
import type { TargetMode, TargetPref } from '../../domain/schema'
import { resolveTarget, TARGET_MAX, TARGET_MIN, type Targets } from '../../domain/targets'
import { isBanded } from '../../domain/taxonomy'
import type { Locale } from '../../i18n/locale'
import { getLocale } from '../../i18n/messages'
import { settingsMessages } from './messages'

export const TARGET_MODES: readonly TargetMode[] = ['normal', 'more', 'less', 'skip', 'custom']

export function modeOf(group: string, targets: Targets): TargetMode {
  return targets[group]?.mode ?? 'normal'
}

/** A custom range with whole numbers inside TARGET_MIN..TARGET_MAX and min below max. */
export function customPref(min: number, max: number): TargetPref {
  const lo = Math.min(TARGET_MAX - 1, Math.max(TARGET_MIN, Math.round(min)))
  const hi = Math.min(TARGET_MAX, Math.max(lo + 1, Math.round(max)))
  return { mode: 'custom', min: lo, max: hi }
}

/** The pref a mode stores; null clears it (Normal). Custom starts from the range shown now. */
export function prefForMode(mode: TargetMode, group: string, targets: Targets): TargetPref | null {
  if (mode === 'normal') return null
  if (mode !== 'custom') return { mode }
  const current = targets[group]
  if (current?.mode === 'custom') return current
  const t = resolveTarget(group, targets)
  const edges = t.edges ?? t.cited
  return edges ? customPref(edges[1], edges[2]) : null
}

/** "target 10-20", "your range 15-25" or "no range set". */
export function rangeText(group: string, targets: Targets, locale: Locale = getLocale()): string {
  const t = resolveTarget(group, targets)
  if (!t.edges) return settingsMessages[locale].noRangeSet
  return targetText(t.edges, { personal: t.mode !== 'normal' }, locale)
}

/** Count of banded groups with a personal range. */
export function changedCount(targets: Targets): number {
  return Object.keys(targets).filter(isBanded).length
}

/** "Research ranges" or "3 changed". */
export function targetsSummary(targets: Targets, locale: Locale = getLocale()): string {
  const n = changedCount(targets)
  const m = settingsMessages[locale]
  return n ? m.rangesChanged(n) : m.researchRanges
}

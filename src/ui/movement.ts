import { mixTotal, MOVEMENT_KEYS, movementGroupNames, type MovementKey, type MovementMix } from '../domain/movement'
import { common } from '../i18n/common'
import type { Locale } from '../i18n/locale'
import { getLocale } from '../i18n/messages'
import { uiMessages } from './messages'

/** Filled surface for a group. Pair with text-mv-ink, which stays dark in both themes. */
export const mvBg: Record<MovementKey, string> = {
  push: 'bg-mv-push',
  pull: 'bg-mv-pull',
  shoulders: 'bg-mv-shoulders',
  arms: 'bg-mv-arms',
  legs: 'bg-mv-legs',
  core: 'bg-mv-core',
  other: 'bg-mv-other',
}

/** Ring color for a white thumbnail tile; add the width yourself (ring-3). */
export const mvRing: Record<MovementKey, string> = {
  push: 'ring-mv-push',
  pull: 'ring-mv-pull',
  shoulders: 'ring-mv-shoulders',
  arms: 'ring-mv-arms',
  legs: 'ring-mv-legs',
  core: 'ring-mv-core',
  other: 'ring-mv-other',
}

export const mvBorder: Record<MovementKey, string> = {
  push: 'border-mv-push',
  pull: 'border-mv-pull',
  shoulders: 'border-mv-shoulders',
  arms: 'border-mv-arms',
  legs: 'border-mv-legs',
  core: 'border-mv-core',
  other: 'border-mv-other',
}

/** CSS custom property for inline styles and canvas token lookups. */
export const mvVar = (key: MovementKey) => `var(--color-mv-${key})`

export function movementLabel(key: MovementKey, locale: Locale = getLocale()): string {
  return movementGroupNames[locale][key]
}

/** Groups with sets, in display order. */
export function mixParts(mix: MovementMix): { key: MovementKey; sets: number }[] {
  return MOVEMENT_KEYS.filter((k) => mix[k] > 0).map((key) => ({ key, sets: mix[key] }))
}

/** "Movement mix: Push 12 sets, Pull 11 sets", leaving out groups with no sets. */
export function mixLabel(mix: MovementMix, locale: Locale = getLocale()): string {
  const m = uiMessages[locale]
  if (mixTotal(mix) === 0) return `${m.movementMix}: ${m.noSets}`
  return `${m.movementMix}: ${mixParts(mix)
    .map((p) => `${movementLabel(p.key, locale)} ${common[locale].sets(p.sets)}`)
    .join(', ')}`
}

import { presetName } from '../../data/localize'
import { equipment, matchPreset } from '../../domain/equipment'
import type { Locale } from '../../i18n/locale'
import { getLocale } from '../../i18n/messages'
import { settingsMessages } from './messages'

/** "Basic gym", or "Custom, 14 of 26 items" when no preset matches. */
export function equipmentSummary(value: readonly string[], locale: Locale = getLocale()): string {
  const preset = matchPreset(value)
  return preset ? presetName(preset, locale) : settingsMessages[locale].customOf(value.length, equipment.length)
}

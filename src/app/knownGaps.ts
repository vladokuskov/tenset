import { activeExercises } from '../data/catalog'
import { hasEquipment } from '../domain/equipment'
import { bandedGroupIds, isOptional } from '../domain/taxonomy'
import type { Locale } from '../i18n/locale'
import { getLocale } from '../i18n/messages'
import { appMessages } from './messages'

/** Required banded groups that no active exercise trains with this equipment, in taxonomy order. */
export function equipmentGaps(equipment: readonly string[]): string[] {
  return bandedGroupIds.filter(
    (g) => !isOptional(g) && !activeExercises.some((e) => e.groups[g] && hasEquipment(e, equipment)),
  )
}

/** Neutral note: "Your equipment can't load: side delts, rear delts." Null when nothing is out of reach. */
export function gapNote(equipment: readonly string[], locale: Locale = getLocale()): string | null {
  const groups = equipmentGaps(equipment)
  if (!groups.length) return null
  return appMessages[locale].gapNote(groups)
}

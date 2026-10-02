import { dayName } from '../../app/days'
import type { GroupSchedule } from '../../domain/recovery'
import { RECOVERY_MIN_SETS } from '../../domain/recovery'
import type { Locale } from '../../i18n/locale'
import { getLocale } from '../../i18n/messages'
import { bodymapMessages } from './messages'

/** Neutral schedule line: "Trained Mon, Thu, Sat · gaps 3, 2, 2 days". */
export function scheduleText(schedule: GroupSchedule | undefined, weekly: number, locale: Locale = getLocale()): string {
  const m = bodymapMessages[locale]
  if (weekly <= 0) return m.notTrainedThisWeek
  if (!schedule || schedule.days.length === 0) return m.noDayReaches(RECOVERY_MIN_SETS)
  const days = schedule.days.map((d) => dayName(d, 'short', locale)).join(', ')
  if (schedule.days.length === 1) return m.trainedOnce(days)
  return m.trainedGaps(days, schedule.gaps)
}

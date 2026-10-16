import { BAND_ORDER } from '../../app/bands'
import { APP_NAME, notMedicalAdvice } from '../../app/brand'
import { dayName, type DayIndex } from '../../app/days'
import { formatDaySummary } from '../../app/format'
import type { WeekView } from '../../app/useWeek'
import { groupName } from '../../data/localize'
import { MOVEMENT_KEYS, movementGroupNames } from '../../domain/movement'
import type { Catalog } from '../../domain/resolve'
import { dateFormat } from '../../i18n/format'
import { common } from '../../i18n/common'
import type { Locale } from '../../i18n/locale'
import { uiMessages } from '../../ui/messages'
import { bodymapMessages } from '../bodymap/messages'
import type { DayImageContent, WeekImageContent } from './image'
import { exportMessages } from './messages'
import { dayEntries, dayTitle } from './planText'

export const dayImageName = (day: DayIndex) => `gym-plan-${dayName(day, 'long', 'en').toLowerCase()}.png`
export const WEEK_IMAGE_NAME = 'gym-plan-week.png'

export function dayImageContent(view: WeekView, day: DayIndex, catalog: Catalog, locale: Locale): DayImageContent {
  const m = exportMessages[locale]
  const s = view.days[day]
  const rest = s.kind === 'rest'
  return {
    title: dayTitle(day, s.label, locale),
    summary: rest ? m.image.restDay : formatDaySummary(s.exercises, s.hardSets, locale, s.estMinutes),
    rows: dayEntries(view.program, day, catalog, locale),
    groupNames: movementGroupNames[locale],
    empty: rest ? m.image.restDay : m.noExercisesYet,
    note: s.note ? m.note(s.note) : undefined,
    footer: notMedicalAdvice(locale),
    app: APP_NAME,
  }
}

export function weekImageContent(view: WeekView, locale: Locale, today = new Date()): WeekImageContent {
  const m = exportMessages[locale]
  const totalSets = view.days.reduce((n, d) => n + d.hardSets, 0)
  const trainingDays = view.days.filter((d) => d.kind === 'train').length
  return {
    title: view.program.name,
    subtitle: m.header(trainingDays, totalSets, dateFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(today)),
    rows: view.order.map((d) => {
      const s = view.days[d]
      const rest = s.kind === 'rest'
      return {
        day: dayName(d, 'short', locale),
        title: rest ? undefined : s.label,
        summary: rest ? m.image.restDay : formatDaySummary(s.exercises, s.hardSets, locale, s.estMinutes),
        groups: s.topGroups.length ? s.topGroups.map((g) => groupName(g, locale)).join(', ') : undefined,
        mix: rest ? undefined : s.mix,
        rest,
      }
    }),
    legend: BAND_ORDER.map((band) => ({ band, label: bodymapMessages[locale].legend[band] })),
    mapCaption: m.image.mapCaption,
    mix: {
      title: uiMessages[locale].movementMix,
      total: view.mix,
      legend: MOVEMENT_KEYS.filter((k) => view.mix[k] > 0).map((group) => ({
        group,
        label: `${movementGroupNames[locale][group]} ${common[locale].sets(view.mix[group])}`,
      })),
    },
    footer: notMedicalAdvice(locale),
    app: APP_NAME,
  }
}

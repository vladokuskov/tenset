import { groupName } from '../data/localize.ts'
import type { TemplateNote } from '../domain/program.ts'
import { common } from '../i18n/common.ts'
import type { Locale } from '../i18n/locale.ts'
import { defineMessages, getLocale } from '../i18n/messages.ts'
import { dayName } from './days.ts'
import { formatSets } from './format.ts'

/** Ukrainian genitive after "менше" and "від ... до": 4 підходів, 21 підходу, 7,5 підходу ("понад" takes the plain count). */
function ukSetsOf(value: number): string {
  const n = Math.round(value * 10) / 10
  return !Number.isInteger(n) || (n % 10 === 1 && n % 100 !== 11) ? 'підходу' : 'підходів'
}

type Edges = readonly number[]
const enN = (n: number) => formatSets(n, 'en')
const ukSets = (n: number) => `${formatSets(n, 'uk')} ${ukSetsOf(n)}`
const ukN = (n: number) => formatSets(n, 'uk')

export const appMessages = defineMessages({
  en: {
    notMedicalAdvice: 'General information for planning training. Not medical advice.',
    defaultProgramName: 'My program',
    customExercise: 'Custom exercise',
    band: {
      none: 'not trained',
      some: 'some sets',
      light: 'light',
      moderate: 'moderate',
      moderateGeneral: 'good for general fitness',
      target: 'target range',
      high: 'high',
      very_high: 'very high',
    },
    targetText: (lo: number, hi: number) => `target ${formatSets(lo, 'en')}-${formatSets(hi, 'en')}`,
    yourRangeText: (lo: number, hi: number) => `your range ${formatSets(lo, 'en')}-${formatSets(hi, 'en')}`,
    citedRange: (lo: number, hi: number) => `Research range: ${enN(lo)}-${enN(hi)} sets a week. You set your own.`,
    range: {
      none: '0 sets',
      light: ([a]: Edges) => `fewer than ${enN(a)} sets`,
      moderate: ([a, b]: Edges) => `${enN(a)} to ${enN(b)} sets`,
      target: ([, b, c]: Edges) => `${enN(b)} to ${enN(c)} sets`,
      high: ([, , c, d]: Edges) => `${enN(c)} to ${enN(d)} sets`,
      very_high: ([, , , d]: Edges) => `over ${enN(d)} sets`,
    },
    explain: {
      none: 'No sets count toward this group this week.',
      some: ([a]: Edges) => `Fewer than ${enN(a)} weekly sets. This group is optional.`,
      light: ([a]: Edges) => `Fewer than ${enN(a)} weekly sets.`,
      moderate: ([a, b]: Edges) => `${enN(a)} to ${enN(b)} weekly sets.`,
      moderateGeneral: ([a, b]: Edges) => `${enN(a)} to ${enN(b)} weekly sets, which is plenty for general fitness.`,
      target: ([, b, c]: Edges) => `${enN(b)} to ${enN(c)} weekly sets, the range most studies use for muscle growth.`,
      targetPersonal: ([, b, c]: Edges) => `${enN(b)} to ${enN(c)} weekly sets, inside your range.`,
      high: ([, , c, d]: Edges) => `${enN(c)} to ${enN(d)} weekly sets. Each extra set adds less than the ones before it.`,
      very_high: ([, , , d]: Edges) => `More than ${enN(d)} weekly sets.`,
    },
    gapNote: (groups: readonly string[]) =>
      `Your equipment can't load: ${groups.map((g) => groupName(g, 'en').toLowerCase()).join(', ')}.`,
    droppedSlot: (day: number, group: string) =>
      `${dayName(day, 'short', 'en')}: no option for your equipment, so the ${groupName(group, 'en').toLowerCase()} slot was left out.`,
    dayCount: (expected: number, got: number) => `This template is built for ${expected} days a week; it was placed on ${got}.`,
  },
  uk: {
    notMedicalAdvice: 'Загальна інформація для планування тренувань. Не медична порада.',
    defaultProgramName: 'Моя програма',
    customExercise: 'Власна вправа',
    band: {
      none: 'не тренується',
      some: 'кілька підходів',
      light: 'мало',
      moderate: 'помірно',
      moderateGeneral: 'добре для загальної форми',
      target: 'цільовий діапазон',
      high: 'багато',
      very_high: 'дуже багато',
    },
    targetText: (lo, hi) => `ціль ${formatSets(lo, 'uk')}-${formatSets(hi, 'uk')}`,
    yourRangeText: (lo, hi) => `ваш діапазон ${formatSets(lo, 'uk')}-${formatSets(hi, 'uk')}`,
    citedRange: (lo, hi) => `Діапазон із досліджень: ${ukN(lo)}-${common.uk.sets(hi)} на тиждень. Ви задали свій.`,
    range: {
      none: '0 підходів',
      light: ([a]) => `менше ${ukSets(a)}`,
      moderate: ([a, b]) => `від ${ukN(a)} до ${ukSets(b)}`,
      target: ([, b, c]) => `від ${ukN(b)} до ${ukSets(c)}`,
      high: ([, , c, d]) => `від ${ukN(c)} до ${ukSets(d)}`,
      very_high: ([, , , d]) => `понад ${common.uk.sets(d)}`,
    },
    explain: {
      none: 'Цього тижня жоден підхід не зараховується цій групі.',
      some: ([a]) => `Менше ${ukSets(a)} на тиждень. Ця група необовʼязкова.`,
      light: ([a]) => `Менше ${ukSets(a)} на тиждень.`,
      moderate: ([a, b]) => `Від ${ukN(a)} до ${ukSets(b)} на тиждень.`,
      moderateGeneral: ([a, b]) => `Від ${ukN(a)} до ${ukSets(b)} на тиждень, цього вистачає для загальної форми.`,
      target: ([, b, c]) => `Від ${ukN(b)} до ${ukSets(c)} на тиждень, діапазон, який використовує більшість досліджень росту мʼязів.`,
      targetPersonal: ([, b, c]) => `Від ${ukN(b)} до ${ukSets(c)} на тиждень, у межах вашого діапазону.`,
      high: ([, , c, d]) => `Від ${ukN(c)} до ${ukSets(d)} на тиждень. Кожен додатковий підхід дає менше, ніж попередні.`,
      very_high: ([, , , d]) => `Понад ${common.uk.sets(d)} на тиждень.`,
    },
    gapNote: (groups) => `Ваше обладнання не навантажує: ${groups.map((g) => groupName(g, 'uk').toLocaleLowerCase('uk')).join(', ')}.`,
    droppedSlot: (day, group) =>
      `${dayName(day, 'short', 'uk')}: для вашого обладнання немає варіанта, тому слот «${groupName(group, 'uk')}» пропущено.`,
    dayCount: (expected, got) => `Цей шаблон розрахований на ${common.uk.days(expected)} на тиждень; його розміщено на ${common.uk.days(got)}.`,
  },
})

export function notMedicalAdvice(locale: Locale = getLocale()): string {
  return appMessages[locale].notMedicalAdvice
}

/** One sentence for a note from applyTemplate. */
export function templateNoteText(note: TemplateNote, locale: Locale = getLocale()): string {
  const m = appMessages[locale]
  return note.kind === 'dropped_slot' ? m.droppedSlot(note.day, note.group) : m.dayCount(note.expected, note.got)
}

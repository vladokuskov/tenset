import { common } from '../../i18n/common'
import { defineMessages } from '../../i18n/messages'
import { plural } from '../../i18n/plural'

const uk = common.uk

const setWord = (n: number) => plural('en', n, { one: 'set', other: 'sets' })

export const sharedMessages = defineMessages({
  en: {
    noMusclesMapped: 'No muscles mapped',
    customMeta: (muscles: string) => `Custom, your mapping · ${muscles}`,
    repsEmpty: 'Reps',
    timeEmpty: 'Time',
    reps: (reps: string) => `${reps} reps`,
    seconds: (reps: string) => `${reps} s`,
    withDelta: (base: string, detail: string) => `${base} · ${detail}`,
    supersetSplit: (base: string) => `${base}. Superset split`,
    setsChanged: (name: string, n: number) => `${name}: ${n} ${setWord(n)}`,
    setsFor: (name: string) => `Sets for ${name}`,
    fewerSetsOf: (name: string) => `Fewer sets of ${name}`,
    moreSetsOf: (name: string) => `More sets of ${name}`,
    swap: {
      action: 'Swap to my equipment',
      needOther: (n: number) => `${common.en.exercises(n)} ${plural('en', n, { one: 'needs', other: 'need' })} items you have not selected.`,
      keeps: 'Each swap keeps the same main muscles and movement.',
      noFit: (n: number) =>
        `${common.en.exercises(n)} without a fitting alternative ${plural('en', n, { one: 'stays', other: 'stay' })} as ${plural('en', n, { one: 'it is', other: 'they are' })}.`,
      to: 'to',
      apply: (n: number) => `Swap ${common.en.exercises(n)}`,
      done: (n: number) => `Swapped ${common.en.exercises(n)}`,
    },
  },
  uk: {
    noMusclesMapped: 'Мʼязи не позначено',
    customMeta: (muscles) => `Власна, ваша розмітка · ${muscles}`,
    repsEmpty: 'Повторення',
    timeEmpty: 'Час',
    reps: (reps) => `${reps} повт.`,
    seconds: (reps) => `${reps} с`,
    withDelta: (base, detail) => `${base} · ${detail}`,
    supersetSplit: (base) => `${base}. Суперсет розділено`,
    setsChanged: (name, n) => `${name}: ${uk.sets(n)}`,
    setsFor: (name) => `Підходи: ${name}`,
    fewerSetsOf: (name) => `Менше підходів: ${name}`,
    moreSetsOf: (name) => `Більше підходів: ${name}`,
    swap: {
      action: 'Замінити під моє обладнання',
      needOther: (n) => `Для ${n} ${plural('uk', n, { one: 'вправи', few: 'вправ', many: 'вправ', other: 'вправи' })} потрібне обладнання, яке ви не вибрали.`,
      keeps: 'Кожна заміна зберігає ті самі основні мʼязи й тип руху.',
      noFit: (n) =>
        `${common.uk.exercises(n)} без відповідної заміни ${plural('uk', n, { one: 'лишається', few: 'лишаються', many: 'лишаються', other: 'лишаються' })} без змін.`,
      to: 'на',
      apply: (n) => `Застосувати заміни (${n})`,
      done: (n) => `Замінено: ${common.uk.exercises(n)}`,
    },
  },
})

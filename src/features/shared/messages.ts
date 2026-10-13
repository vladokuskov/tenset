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
  },
})

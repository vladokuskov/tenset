import { formatSets } from '../app/format.ts'
import { defineMessages } from './messages.ts'
import { plural } from './plural.ts'

/** Counts and labels shared across features. Feature copy lives next to each feature. */
export const common = defineMessages({
  en: {
    sets: (n: number) => `${formatSets(n, 'en')} ${plural('en', n, { one: 'set', other: 'sets' })}`,
    hardSets: (n: number) => `${formatSets(n, 'en')} working ${plural('en', n, { one: 'set', other: 'sets' })}`,
    exercises: (n: number) => `${n} ${plural('en', n, { one: 'exercise', other: 'exercises' })}`,
    programs: (n: number) => `${n} ${plural('en', n, { one: 'program', other: 'programs' })}`,
    trainingDays: (n: number) => `${n} ${plural('en', n, { one: 'training day', other: 'training days' })}`,
    days: (n: number) => `${n} ${plural('en', n, { one: 'day', other: 'days' })}`,
    slots: (n: number) => `${n} ${plural('en', n, { one: 'slot', other: 'slots' })}`,
    noExercisesYet: 'No exercises yet',
    bodyweight: 'Bodyweight',
    undo: 'Undo',
    undone: 'Undone',
    back: ', back',
    close: 'Close',
    cancel: 'Cancel',
    done: 'Done',
    save: 'Save',
  },
  uk: {
    sets: (n) => `${formatSets(n, 'uk')} ${plural('uk', n, { one: 'підхід', few: 'підходи', many: 'підходів', other: 'підходу' })}`,
    hardSets: (n) =>
      `${formatSets(n, 'uk')} ${plural('uk', n, {
        one: 'робочий підхід',
        few: 'робочі підходи',
        many: 'робочих підходів',
        other: 'робочого підходу',
      })}`,
    exercises: (n) => `${n} ${plural('uk', n, { one: 'вправа', few: 'вправи', many: 'вправ', other: 'вправи' })}`,
    programs: (n) => `${n} ${plural('uk', n, { one: 'програма', few: 'програми', many: 'програм', other: 'програми' })}`,
    trainingDays: (n) =>
      `${n} ${plural('uk', n, {
        one: 'тренувальний день',
        few: 'тренувальні дні',
        many: 'тренувальних днів',
        other: 'тренувального дня',
      })}`,
    days: (n) => `${n} ${plural('uk', n, { one: 'день', few: 'дні', many: 'днів', other: 'дня' })}`,
    slots: (n) => `${n} ${plural('uk', n, { one: 'слот', few: 'слоти', many: 'слотів', other: 'слота' })}`,
    noExercisesYet: 'Вправ поки немає',
    bodyweight: 'Власна вага',
    undo: 'Скасувати',
    undone: 'Скасовано',
    back: ', назад',
    close: 'Закрити',
    cancel: 'Скасувати',
    done: 'Готово',
    save: 'Зберегти',
  },
})

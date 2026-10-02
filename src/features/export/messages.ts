import { APP_NAME } from '../../app/brand'
import { formatSets } from '../../app/format'
import { common } from '../../i18n/common'
import { defineMessages } from '../../i18n/messages'
import { plural } from '../../i18n/plural'
import type { BackupError } from './backup'

const enMappings = (n: number) => `${n} ${plural('en', n, { one: 'custom mapping', other: 'custom mappings' })}`
const ukMappings = (n: number) =>
  `${n} ${plural('uk', n, { one: 'власна розмітка', few: 'власні розмітки', many: 'власних розміток', other: 'власної розмітки' })}`

export const exportMessages = defineMessages({
  en: {
    errors: {
      too_large: `This file is too large to be a ${APP_NAME} backup.`,
      not_json: `This file is not a ${APP_NAME} backup.`,
      wrong_file: `This file is not a ${APP_NAME} backup.`,
      newer_version: 'This backup comes from a newer version of the app. Reload to update, then try again.',
      invalid: 'This backup could not be read. It may be damaged or edited.',
    } satisfies Record<BackupError, string>,
    imported: (programs: number, settings: boolean) =>
      [programs ? `Added ${common.en.programs(programs)}` : null, settings ? 'settings updated' : null].filter(Boolean).join(', ') ||
      'Nothing to import',
    shareTitle: `${APP_NAME} backup`,
    title: 'Export or import',
    backUp: 'Back up',
    backupText: (programs: number, mappings: number) =>
      `One file with ${common.en.programs(programs)} and your settings${mappings ? `, including ${enMappings(mappings)}` : ''}. Keep it somewhere safe: this app stores everything on this device only.`,
    download: 'Download backup',
    shareFile: 'Share file',
    importHeading: 'Import',
    importText: 'Programs in the file are added as new programs. Nothing you have is overwritten.',
    choose: 'Choose backup file',
    pendingSummary: (programs: number, date: string | null) => `${common.en.programs(programs)}${date ? `, saved ${date}` : ''}`,
    skipped: (n: number) => `${common.en.programs(n)} could not be read and will be skipped.`,
    alsoSettings: 'Also use the settings from this file (goal, equipment, counting, week start, custom mappings)',
    cancel: common.en.cancel,
    importButton: 'Import',
    printHeading: 'Print',
    printText: 'A one-page week table with the body map, for paper or PDF.',
    openPrint: 'Open print view',

    // PrintPage
    nothingToPrint: 'Nothing to print yet',
    createPlan: 'Create a plan',
    createFirst: 'Create a program first, then print its week.',
    plan: 'Plan',
    print: 'Print',
    header: (days: number, sets: number, date: string) =>
      `Week plan · ${common.en.trainingDays(days)} · ${formatSets(sets, 'en')} hard sets · ${date}`,
    day: 'Day',
    exercise: 'Exercise',
    sets: 'Sets',
    reps: 'Reps',
    rest: 'Rest',
    noExercisesYet: common.en.noExercisesYet,
    note: (text: string) => `Note: ${text}`,
    mapLabel: 'Weekly sets per muscle group, front and back',
    countOf: (n: number, total: number) => `${n} of ${total}`,
    groupsTrained: 'groups trained.',
    notTrained: (list: string) => ` Not trained: ${list}.`,
    footer: (disclaimer: string) => `${disclaimer} Made with ${APP_NAME}.`,
  },
  uk: {
    errors: {
      too_large: `Файл завеликий для резервної копії ${APP_NAME}.`,
      not_json: `Цей файл не є резервною копією ${APP_NAME}.`,
      wrong_file: `Цей файл не є резервною копією ${APP_NAME}.`,
      newer_version: 'Резервну копію створено новішою версією застосунку. Перезавантажте сторінку, щоб оновити, і спробуйте ще раз.',
      invalid: 'Не вдалося прочитати резервну копію. Можливо, файл пошкоджено або змінено.',
    },
    imported: (programs, settings) => {
      if (programs && settings) return `Додано ${common.uk.programs(programs)}, налаштування оновлено`
      if (programs) return `Додано ${common.uk.programs(programs)}`
      if (settings) return 'Налаштування оновлено'
      return 'Нічого імпортувати'
    },
    shareTitle: `Резервна копія ${APP_NAME}`,
    title: 'Експорт або імпорт',
    backUp: 'Резервна копія',
    backupText: (programs, mappings) =>
      `Один файл: ${common.uk.programs(programs)} і ваші налаштування${mappings ? `, зокрема ${ukMappings(mappings)}` : ''}. Зберігайте його в надійному місці: застосунок зберігає все лише на цьому пристрої.`,
    download: 'Завантажити копію',
    shareFile: 'Поділитися файлом',
    importHeading: 'Імпорт',
    importText: 'Програми з файлу додаються як нові. Наявні програми не перезаписуються.',
    choose: 'Обрати файл резервної копії',
    pendingSummary: (programs, date) => `${common.uk.programs(programs)}${date ? `, збережено ${date}` : ''}`,
    skipped: (n) => `Не вдалося прочитати, тому буде пропущено: ${common.uk.programs(n)}.`,
    alsoSettings: 'Також застосувати налаштування з файлу (мета, обладнання, підрахунок, початок тижня, власна розмітка)',
    cancel: common.uk.cancel,
    importButton: 'Імпортувати',
    printHeading: 'Друк',
    printText: 'Таблиця тижня на одну сторінку з картою тіла, для паперу або PDF.',
    openPrint: 'Відкрити версію для друку',

    nothingToPrint: 'Поки нічого друкувати',
    createPlan: 'Створити план',
    createFirst: 'Спершу створіть програму, потім надрукуйте її тиждень.',
    plan: 'План',
    print: 'Друкувати',
    header: (days, sets, date) => `План на тиждень · ${common.uk.trainingDays(days)} · ${common.uk.hardSets(sets)} · ${date}`,
    day: 'День',
    exercise: 'Вправа',
    sets: 'Підходи',
    reps: 'Повторення',
    rest: 'Відпочинок',
    noExercisesYet: common.uk.noExercisesYet,
    note: (text) => `Нотатка: ${text}`,
    mapLabel: 'Підходи на тиждень за групами мʼязів, спереду і ззаду',
    countOf: (n, total) => `${n} з ${total}`,
    groupsTrained: 'груп мʼязів у роботі.',
    notTrained: (list) => ` Не тренуються: ${list}.`,
    footer: (disclaimer) => `${disclaimer} Створено в ${APP_NAME}.`,
  },
})

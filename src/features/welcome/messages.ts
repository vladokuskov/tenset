import { APP_NAME } from '../../app/brand'
import { common } from '../../i18n/common'
import { defineMessages } from '../../i18n/messages'
import { plural } from '../../i18n/plural'

export const welcomeMessages = defineMessages({
  en: {
    heading: { 1: `Plan your week with ${APP_NAME}`, 2: 'Which days do you train?', 3: 'What can you use?' },
    sub: {
      1: 'Start from a split and adjust it, or fill seven empty days yourself. The map shows how much each muscle gets.',
      2: 'Pick the days you plan to train. The others become rest days.',
      3: 'Exercises that need equipment you do not have are left out.',
    },
    skip: 'Skip',
    step: (n: number, total: number) => `Step ${n} of ${total}`,
    dropped: (n: number) => `${common.en.slots(n)} left out for your equipment. You can add others on each day.`,
    daysAWeek: (n: number) => `${n} days a week`,
    level: { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced' } as Record<number, string>,
    groupsOf: (trained: number, total: number) => `${trained} of ${total} groups`,
    setsAWeek: (n: number) => `${n} sets a week`,
    startBlank: 'Start blank',
    sevenEmpty: 'Seven empty days',
    blankDescription: 'Add exercises day by day and watch the map fill in.',
    trainingDays: 'Training days',
    pickOne: 'Pick at least one day.',
    repeats: (name: string, builtFor: number, chosen: number) =>
      `${name} is built for ${builtFor} days a week. On ${chosen} ${plural('en', chosen, { one: 'day', other: 'days' })} its sessions repeat in order.`,
    daySplit: (training: number, rest: number) =>
      `${common.en.trainingDays(training)}, ${rest} ${plural('en', rest, { one: 'rest day', other: 'rest days' })}.`,
    back: 'Back',
    continue: 'Continue',
    showWeek: 'Show my week',
  },
  uk: {
    heading: { 1: `Плануйте тиждень з ${APP_NAME}`, 2: 'У які дні ви тренуєтеся?', 3: 'Яке обладнання у вас є?' },
    sub: {
      1: 'Почніть зі спліту й налаштуйте його або заповніть сім порожніх днів самостійно. Карта показує, скільки отримує кожен мʼяз.',
      2: 'Оберіть дні, коли плануєте тренуватися. Решта стануть днями відпочинку.',
      3: 'Вправи, для яких потрібне обладнання, якого у вас немає, не пропонуються.',
    },
    skip: 'Пропустити',
    step: (n, total) => `Крок ${n} з ${total}`,
    dropped: (n) => `Через ваше обладнання пропущено ${common.uk.slots(n)}. Інші вправи можна додати в кожен день.`,
    daysAWeek: (n) => `${common.uk.days(n)} на тиждень`,
    level: { 1: 'Початковий', 2: 'Середній', 3: 'Просунутий' },
    groupsOf: (trained, total) => `${trained} з ${total} груп`,
    setsAWeek: (n) => `${common.uk.sets(n)} на тиждень`,
    startBlank: 'Почати з нуля',
    sevenEmpty: 'Сім порожніх днів',
    blankDescription: 'Додавайте вправи день за днем і стежте, як заповнюється карта.',
    trainingDays: 'Тренувальні дні',
    pickOne: 'Оберіть хоча б один день.',
    repeats: (name, builtFor, chosen) =>
      `«${name}» розраховано на ${common.uk.days(builtFor)} на тиждень. На ${common.uk.days(chosen)} його тренування повторюються по черзі.`,
    daySplit: (training, rest) =>
      `${common.uk.trainingDays(training)}, ${rest} ${plural('uk', rest, { one: 'день відпочинку', few: 'дні відпочинку', many: 'днів відпочинку', other: 'дня відпочинку' })}.`,
    back: 'Назад',
    continue: 'Далі',
    showWeek: 'Показати мій тиждень',
  },
})

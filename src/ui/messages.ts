import { defineMessages } from '../i18n/messages'

export const uiMessages = defineMessages({
  en: {
    nav: { main: 'Main', plan: 'Plan', body: 'Body', exercises: 'Exercises', settings: 'Settings' },
    close: 'Close',
    back: ', back',
    decrease: 'Decrease',
    increase: 'Increase',
    search: 'Search',
    noMatches: 'No matches',
    language: { en: 'English', uk: 'Ukrainian' },
  },
  uk: {
    nav: { main: 'Головне', plan: 'План', body: 'Тіло', exercises: 'Вправи', settings: 'Налаштування' },
    close: 'Закрити',
    back: ', назад',
    decrease: 'Зменшити',
    increase: 'Збільшити',
    search: 'Пошук',
    noMatches: 'Нічого не знайдено',
    language: { en: 'Англійська', uk: 'Українська' },
  },
})

import type { ReactNode } from 'react'
import { defineMessages } from '../i18n/messages'

export const swMessages = defineMessages({
  en: {
    updateReady: 'A new version is ready.',
    reload: 'Reload',
    later: 'Later',
    installLabel: 'Add to Home Screen',
    installTitleIos: 'Add to your Home Screen',
    installTitleMac: 'Add to your Dock',
    installBody: 'Safari may clear data for sites you have not opened in 7 days. Installed, your programs stay put and the app works offline.',
    share: 'Share',
    installStepsIos: (shareIcon: ReactNode): ReactNode[] => ['Tap ', shareIcon, ', then Add to Home Screen.'],
    installStepsMac: 'In the menu bar choose File, then Add to Dock.',
    dismiss: 'Dismiss',
  },
  uk: {
    updateReady: 'Нова версія готова.',
    reload: 'Оновити',
    later: 'Пізніше',
    installLabel: 'Додати на початковий екран',
    installTitleIos: 'Додайте на початковий екран',
    installTitleMac: 'Додайте в Dock',
    installBody:
      'Safari може видаляти дані сайтів, які ви не відкривали 7 днів. Після встановлення ваші програми залишаться на місці, а застосунок працюватиме офлайн.',
    share: 'Поширити',
    installStepsIos: (shareIcon) => ['Торкніться ', shareIcon, ', потім «На початковий екран».'],
    installStepsMac: 'У рядку меню виберіть «Файл», потім «Додати в Dock».',
    dismiss: 'Закрити',
  },
})

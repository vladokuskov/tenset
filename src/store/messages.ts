import { defineMessages } from '../i18n/messages.ts'

export const storeMessages = defineMessages({
  en: {
    copyName: (name: string) => `${name} copy`,
  },
  uk: {
    copyName: (name) => `${name} (копія)`,
  },
})

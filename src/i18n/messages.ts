import { prefsStore, usePrefsStore } from '../store/prefs.store.ts'
import type { Locale } from './locale.ts'

export type Messages<T> = { readonly en: T; readonly uk: NoInfer<T> }

/** English is the source; the Ukrainian object must have exactly the same keys and signatures. */
export function defineMessages<T>(messages: Messages<T>): Messages<T> {
  return messages
}

export function useLocale(): Locale {
  return usePrefsStore((s) => s.locale)
}

/** For code outside React (toasts, store callbacks). Read at call time, never at import. */
export function getLocale(): Locale {
  return prefsStore.getState().locale
}

export function useMessages<T>(messages: Messages<T>): T {
  return messages[useLocale()]
}

export function getMessages<T>(messages: Messages<T>): T {
  return messages[getLocale()]
}

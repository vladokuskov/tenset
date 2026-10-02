import { useEffect } from 'react'
import { prefsStore } from '../store/prefs.store'
import type { Locale } from './locale'
import { useLocale } from './messages'

export function setLocale(locale: Locale): void {
  prefsStore.getState().setLocale(locale)
}

/** Keeps <html lang> in step with the chosen language so screen readers switch voices. */
export function useDocumentLocale(): Locale {
  const locale = useLocale()
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  return locale
}

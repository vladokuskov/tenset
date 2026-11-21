import { useEffect } from 'react'
import { APP_NAME } from '../app/brand'
import type { Locale } from '../i18n/locale'
import { useLocale } from '../i18n/messages'
import { rootMessages } from './-messages'

type Titles = (typeof rootMessages)['en']['titles']

const STATIC: Record<string, keyof Titles> = {
  '/': 'exercises',
  '/credits': 'credits',
  '/privacy': 'privacy',
}

/** document.title for a pathname, e.g. "Credits · Tenset". */
export function routeTitle(pathname: string, locale: Locale): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (path.startsWith('/dev/')) return APP_NAME
  const m = rootMessages[locale]
  const key = STATIC[path]
  return `${key ? m.titles[key] : m.notFound.title} · ${APP_NAME}`
}

/** Sets document.title from the path in the current language; the root layout calls it once for every route. */
export function useDocumentTitle(pathname: string): void {
  const locale = useLocale()
  useEffect(() => {
    document.title = routeTitle(pathname, locale)
  }, [pathname, locale])
}

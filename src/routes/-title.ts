import { useEffect } from 'react'
import { APP_NAME } from '../app/brand'
import { dayFromSlug, dayName, isDaySlug } from '../app/days'
import { defaultCatalogData, useLocalizedCatalog } from '../app/useCatalog'
import type { Locale } from '../i18n/locale'
import { useLocale } from '../i18n/messages'
import { rootMessages } from './-messages'

type Titles = (typeof rootMessages)['en']['titles']

const STATIC: Record<string, keyof Titles> = {
  '/': 'plan',
  '/body': 'body',
  '/exercises': 'exercises',
  '/settings': 'settings',
  '/about': 'about',
  '/credits': 'credits',
  '/privacy': 'privacy',
  '/shared': 'shared',
  '/print': 'print',
  '/welcome': 'welcome',
}

function pageName(path: string, locale: Locale, exerciseName: (slug: string) => string | undefined): string | null {
  const m = rootMessages[locale]
  if (path.startsWith('/dev/')) return null
  const key = STATIC[path]
  if (key) return m.titles[key]
  const day = /^\/day\/([^/]+)$/.exec(path)
  if (day) return isDaySlug(day[1]) ? dayName(dayFromSlug(day[1]), 'long', locale) : m.notFound.title
  const exercise = /^\/exercise\/([^/]+)$/.exec(path)
  if (exercise) return exerciseName(exercise[1]) ?? m.titles.exercise
  return m.notFound.title
}

/** document.title for a pathname, e.g. "Body · Tenset". */
export function routeTitle(pathname: string, locale: Locale, exerciseName: (slug: string) => string | undefined = () => undefined): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const name = pageName(path, locale, exerciseName)
  return name ? `${name} · ${APP_NAME}` : APP_NAME
}

/** Sets document.title from the path in the current language; the root layout calls it once for every route. */
export function useDocumentTitle(pathname: string): void {
  const locale = useLocale()
  const { exerciseBySlug } = useLocalizedCatalog(defaultCatalogData)
  useEffect(() => {
    document.title = routeTitle(pathname, locale, (slug) => exerciseBySlug.get(slug)?.name)
  }, [pathname, locale, exerciseBySlug])
}

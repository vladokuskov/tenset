export const LOCALES = ['en', 'uk'] as const
export type Locale = (typeof LOCALES)[number]

/** Ukrainian for uk-* browsers, English for everything else. */
export function detectLocale(tag?: string): Locale {
  const lang = tag ?? globalThis.navigator?.language ?? ''
  return lang.toLowerCase().startsWith('uk') ? 'uk' : 'en'
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** Each language in its own script, so people can find theirs without reading the current UI language. */
export const LANGUAGES: Record<Locale, { code: string; name: string }> = {
  en: { code: 'EN', name: 'English' },
  uk: { code: 'УКР', name: 'Українська' },
}

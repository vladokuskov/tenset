import type { Locale } from './locale.ts'

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>()

function cached<F extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, make: () => F): F {
  let f = cache.get(key) as F | undefined
  if (!f) cache.set(key, (f = make()))
  return f
}

export function numberFormat(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cached(`n:${locale}:${JSON.stringify(options)}`, () => new Intl.NumberFormat(locale, options))
}

export function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached(`d:${locale}:${JSON.stringify(options)}`, () => new Intl.DateTimeFormat(locale, options))
}

/** Locale-aware sort for display names. */
export function compareText(locale: Locale, a: string, b: string): number {
  return a.localeCompare(b, locale)
}

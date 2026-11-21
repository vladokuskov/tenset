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

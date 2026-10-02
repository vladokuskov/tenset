import type { Locale } from './locale.ts'

/** English uses one/other; Ukrainian one/few/many plus other for fractions like 7.5. */
export type PluralForms = { one: string; few?: string; many?: string; other: string }

const rules = new Map<Locale, Intl.PluralRules>()

export function pluralCategory(locale: Locale, n: number): Intl.LDMLPluralRule {
  let r = rules.get(locale)
  if (!r) rules.set(locale, (r = new Intl.PluralRules(locale)))
  return r.select(n)
}

export function plural(locale: Locale, n: number, forms: PluralForms): string {
  const cat = pluralCategory(locale, n)
  return (cat === 'one' || cat === 'few' || cat === 'many' ? forms[cat] : undefined) ?? forms.other
}

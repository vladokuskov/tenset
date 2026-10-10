// Ukrainian and Russian spell the same sounds with different letters; folding lets "присед" and "присід" meet halfway.
const FOLD: Readonly<Record<string, string>> = { ё: 'е', ы: 'и', э: 'е', ъ: '', ї: 'і', є: 'е', ґ: 'г' }

// Longest first. Verbal nouns ("присідання", "приседания") lose the whole suffix, so both reach "присід"/"присед".
const CYRILLIC_ENDINGS = [
  'ування', 'ювання', 'ивания', 'ивание',
  'ання', 'яння', 'ення', 'іння', 'ания', 'ание', 'ения', 'ение',
  'ями', 'ами', 'ові', 'ого', 'ому', 'его', 'ему', 'ими', 'іми',
  'ою', 'ею', 'ій', 'ий', 'ой', 'ей', 'ям', 'ах', 'ях', 'ів', 'ов', 'ев', 'ам', 'ом', 'ем', 'им', 'ім',
  'ая', 'яя', 'ое', 'ее', 'ие', 'ої', 'ую', 'юю',
  'а', 'я', 'о', 'е', 'и', 'і', 'у', 'ю', 'ь', 'й',
]
const CYRILLIC = /\p{Script=Cyrillic}/u
const MIN_STEM = 3

/** A rough stem for matching names in notes: case endings off, plural "s" off. Not for display. */
export function stem(term: string): string {
  const t = term.toLowerCase()
  if (!CYRILLIC.test(t)) return t.length >= 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t
  const folded = [...t].map((c) => FOLD[c] ?? c).join('')
  if (folded.length < MIN_STEM + 1) return folded
  for (const end of CYRILLIC_ENDINGS) {
    if (folded.endsWith(end) && folded.length - end.length >= MIN_STEM) return folded.slice(0, -end.length)
  }
  return folded
}

// Pure text rules for the cue originality gate (pipeline/compliance/cues.ts).

export const NGRAM = 7

// Template phrasing common in third-party exercise instructions. Matched on normalized word boundaries.
export const BOILERPLATE = [
  'this will be your starting position',
  'will be your starting position',
  'return to the starting position',
  'back to the starting position',
  'recommended amount of repetitions',
  'recommended amount of reps',
  'repeat for the recommended',
  'for the recommended amount',
  'breathe out as you',
  'breathe in as you',
  'as you breathe out',
  'as you breathe in',
  'exhale as you',
  'inhale as you',
  'as you exhale',
  'as you inhale',
  'while exhaling',
  'while inhaling',
  'hold the contracted position',
  'contracted position for a second',
  'after a brief pause',
  'after a second pause',
  'slowly begin to',
  'upper arms stationary',
  // Ukrainian
  'це ваше вихідне положення',
  'поверніться у вихідне положення',
  'поверніться в вихідне положення',
  'поверніться до вихідного положення',
  'повернутися у вихідне положення',
  'рекомендовану кількість повторень',
  'рекомендовану кількість разів',
  'видихніть під час',
  'вдихніть під час',
  'на видиху виконайте',
  'на вдиху опустіть',
  'затримайтеся у верхній точці на секунду',
  'після короткої паузи',
]

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
}

export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['‘’`ʼ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function ngrams(text: string, n = NGRAM): string[] {
  const w = normalize(text).split(' ').filter(Boolean)
  const out: string[] = []
  for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(' '))
  return out
}

const contains = (haystack: string, needle: string) => ` ${haystack} `.includes(` ${needle} `)

export type CueFinding = { kind: 'ngram' | 'boilerplate'; phrase: string; source?: string }

// corpus maps each third-party 7-gram to the name of its source. Allowlisted phrases exempt the 7-grams they contain.
export function checkCue(cue: string, corpus: Map<string, string>, allow: string[] = []): CueFinding[] {
  const text = normalize(cue)
  const allowed = allow.map(normalize)
  const found: CueFinding[] = []
  for (const gram of new Set(ngrams(cue))) {
    const source = corpus.get(gram)
    if (source && !allowed.some((a) => contains(a, gram))) found.push({ kind: 'ngram', phrase: gram, source })
  }
  for (const phrase of BOILERPLATE) if (contains(text, normalize(phrase))) found.push({ kind: 'boilerplate', phrase })
  return found
}

export function parseAllowlist(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean)
}

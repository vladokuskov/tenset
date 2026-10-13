import type { IdFactory } from './ids.ts'
import {
  LABEL_MAX,
  MAX_SETS,
  RIR_MAX,
  addCustomExercise,
  addEntries,
  blankProgram,
  clampRest,
  linkWithPrev,
  setLabel,
  setRest,
  setRestSec,
  setRir,
  type CustomExerciseInput,
} from './program.ts'
import type { CustomExercise, ExerciseRef, Program } from './schema.ts'

export const IMPORT_MAX_CHARS = 20_000
export const IMPORT_MAX_LINES = 400
const REPS_MAX = 16
// More sets than this in one line is rare enough that a first number above it is read as a weight.
const SETS_FIRST_MAX = 10

type DayIndex = number

export type ParsedLine = {
  raw: string
  name: string
  sets?: number
  reps?: string
  restSec?: number
  rir?: number
  /** Pairs this line with the one above it as a superset. */
  withPrev?: true
  /** The numbers can be read more than one way, so the review asks to check them. */
  unsure?: true
}
export type ParsedDay = { day: DayIndex | null; label?: string; rest: boolean; lines: ParsedLine[] }
export type ImportWarning =
  | { kind: 'unreadable'; line: number; raw: string }
  | { kind: 'truncated' }
  | { kind: 'extra_days'; count: number }
  | { kind: 'extra_weeks'; count: number }
export type ParsedText = { days: ParsedDay[]; warnings: ImportWarning[] }

const fold = (s: string) => s.toLowerCase().replace(/[ʼ’'`]/g, 'ʼ').trim()

// English, Ukrainian, and Russian as people write it in notes (read only, never shown).
const WEEKDAYS: readonly (readonly string[])[] = [
  ['mon', 'monday', 'пн', 'пон', 'понеділок', 'понедельник'],
  ['tue', 'tues', 'tuesday', 'вт', 'вів', 'вівторок', 'вторник'],
  ['wed', 'weds', 'wednesday', 'ср', 'сер', 'середа', 'среда', 'середу', 'среду'],
  ['thu', 'thur', 'thurs', 'thursday', 'чт', 'чет', 'четвер', 'четверг'],
  ['fri', 'friday', 'пт', 'пʼят', 'пʼятниця', 'пятниця', 'пʼятницю', 'пятницю', 'пятница', 'пятницу'],
  ['sat', 'saturday', 'сб', 'суб', 'субота', 'суботу', 'суббота', 'субботу'],
  ['sun', 'sunday', 'нд', 'нед', 'неділя', 'неділю', 'вс', 'вск', 'воскр', 'воскресенье'],
]
const WEEKDAY = new Map(WEEKDAYS.flatMap((names, day) => names.map((n) => [n, day] as const)))

const REST_WORDS =
  /^(?:rest(?: day)?|off|day off|recovery|відпочинок|день відпочинку|вихідний|відновлення|отдых|день отдыха|выходной)\.?$/

const L = '\\p{L}'
const NUM = '\\d{1,3}'
const RANGE = `${NUM}(?:\\s*[-–—]\\s*${NUM})?`
const TIMES = '[xX×хХ*]'
// "10/8/6", "12,10,8": one rep target per set.
const SCHEME = `\\d{1,2}(?:\\s*\\/\\s*\\d{1,2}|,\\d{1,2})+`
const SETS_WORD = `(?:sets?|підх${L}*\\.?|подх${L}*\\.?|сет${L}*)`
const REPS_WORD = `(?:reps?|повт${L}*\\.?|раз${L}*)`
// A lone Cyrillic "с" is also the Russian "with", so it only counts as seconds when no word follows.
const SEC_UNIT = `(?:secs?|seconds?|s|сек${L}*\\.?|с(?!\\s*\\p{L})|"|”)`
const MIN_UNIT = `(?:mins?|minutes?|m|хв${L}*\\.?|мин${L}*\\.?|мін${L}*\\.?|'|’)`
const DIST_UNIT = `(?:meters?|metres?|km|yds?|yards?|ft|feet|м|метр${L}*|км)`
const DIST = `\\d{1,4}(?:[.,]\\d{1,2})?\\s*${DIST_UNIT}`
// A bare "m" is minutes for small numbers ("Bike 20m", "Plank 3x1m") and metres from 100, or from 15 on a carry or sprint.
const METRES = '(?:\\d{3,4}(?:[.,]\\d{1,2})?\\s*m)'
const METRES_MOVING = '(?:(?:1[5-9]|[2-9]\\d|\\d{3,4})(?:[.,]\\d{1,2})?\\s*m)'
const WEIGHT_UNIT = `(?:kgs?|кг|lbs?|фунт${L}*|%)`
const FAIL = `(?:(?:to\\s+)?failure|amrap|max|макс${L}*\\.?|(?:до\\s+)?відмов${L}*|(?:до\\s+)?отказ${L}*)`

// JS \b only knows ASCII letters, so word starts and ends are spelled out.
const B = '(?<![\\p{L}\\d])'
const E = '(?![\\p{L}\\d])'
const re = (src: string, flags = 'iu') => new RegExp(src, flags)

const RX = {
  bullet: /^\s*(?:[-•·◦‣⁃–—>+]+\s*|\*\s+|(?:\d{1,2}[.)]|[a-zA-Z][.)])\s+|\[[\sxXхХ✓✔]?\]\s*)/u,
  superset: re(`^(?:([a-hа-г])\\s?([1-9])\\s*[.):\\-–]?|(ss\\s*\\d?\\s*[.:\\-–]|(?:super\\s?set|суперсет|супер-сет)\\s*\\d?\\s*[.:\\-–]?))\\s+`),
  rir: re(`@?\\s*${B}(?:RIR|ЗП)\\s*[:=]?\\s*(\\d)(?:\\s*[-–]\\s*\\d)?${E}`),
  inReserve: re(`${B}(\\d)\\s*(?:повт${L}*\\s*)?(?:в|у)\\s+запас${L}*`),
  rpe: re(`@?\\s*${B}RPE\\s*[:=]?\\s*(\\d{1,2}(?:[.,]5)?)`),
  at: re(`@\\s*(\\d{1,3}(?:[.,]\\d{1,2})?)(?![\\d\\p{L}])`),
  failTimes: re(`(?<![\\d.])(\\d{1,2})\\s*${TIMES}\\s*${FAIL}${E}`),
  fail: re(`${B}${FAIL}${E}`),
  rest: re(
    `${B}(?:(?:with|з|із|с)\\s+)?(?:rest|відпочин${L}*|відп\\.?|пауза|отдых${L}*|отд\\.?)\\s*(?:between sets|між підходами|между подходами)?\\s*[:=-]?\\s*(\\d{1,3}(?:[.,]\\d)?)(?:\\s*[-–]\\s*\\d{1,3}(?:[.,]\\d)?)?\\s*(${MIN_UNIT}|${SEC_UNIT}|:\\d{2})?${E}`,
  ),
  restAfter: re(`(?<![\\d.])(\\d{1,3}(?:[.,]\\d)?)\\s*(${MIN_UNIT}|${SEC_UNIT})\\s*(?:rest|відпочинку?|отдыха?)${E}`),
  tempo: re(`${B}(?:tempo|темп)\\s*[:=]?\\s*[\\dxXхХ]{1,2}(?:[-/]?[\\dxXхХ]){2,3}${E}`),
  side: re(
    `(?:${B}(?:each|per)\\s+(?:side|leg|arm|hand|way)s?|${B}each|\\/\\s*(?:side|leg|arm)|${B}e\\/s|на\\s+кож(?:ну|ен|ну)\\s+(?:ногу|руку|сторону|бік)|на\\s+каждую\\s+(?:ногу|руку|сторону)|кожною\\s+(?:ногою|рукою)|каждой\\s+(?:ногой|рукой))${E}`,
  ),
  weight: re(`(?:@|${B}(?:по|with|з|с))?\\s*(?<![\\d.])\\d{1,3}(?:[.,]\\d{1,2})?\\s*${WEIGHT_UNIT}${E}`),
  triple: re(`(?<![\\d.])(\\d{1,3}(?:[.,]\\d{1,2})?)\\s*${TIMES}\\s*(\\d{1,3})\\s*${TIMES}\\s*(\\d{1,3})${E}`),
  pair: re(`(?<![\\d.])(\\d{1,3}(?:[.,]\\d{1,2})?)\\s*${TIMES}\\s*(\\d{1,2})(?![\\d.]|\\s*${TIMES})`, 'giu'),
  setsDist: re(`(?<![\\d.])(\\d{1,2})\\s*${TIMES}\\s*(?:${DIST}|${METRES})${E}`),
  dist: re(`(?<![\\d.])(?:${DIST}|${METRES})${E}`),
  moving: re(`${B}(?:carry|carries|walk|farmer${L}*|sled|sprints?|shuttle|run|прогулянк${L}*|фермер${L}*|сан${L}*|спринт${L}*|біг|прогулк${L}*|бег)${E}`),
  setsDistMoving: re(`(?<![\\d.])(\\d{1,2})\\s*${TIMES}\\s*(?:${DIST}|${METRES_MOVING})${E}`),
  distMoving: re(`(?<![\\d.])(?:${DIST}|${METRES_MOVING})${E}`),
  setsTimes: re(`(?<![\\d.])(\\d{1,3})\\s*${TIMES}\\s*(${SCHEME}|${RANGE})\\s*(${SEC_UNIT}|${MIN_UNIT}|${REPS_WORD})?${E}`),
  setsOf: re(
    `(?<![\\d.])(\\d{1,2})\\s*(?:${SETS_WORD}\\s*(?:of|x|×|х|по|by|,)?|(?:рази?|раза)\\s+по|по)\\s*(${RANGE})\\s*(?:${REPS_WORD})?${E}`,
  ),
  scheme: re(`(?<![\\d.:/])(\\d{1,2}(?:\\s*\\/\\s*\\d{1,2}){2,}|\\d{1,2}(?:-\\d{1,2}){2,})(?![\\d/])`),
  repsOnly: re(`(?:${B}по\\s+)?(?<![\\d.])(${RANGE})\\s*${REPS_WORD}${E}`),
  setsOnly: re(`(?<![\\d.])(\\d{1,2})\\s*${SETS_WORD}${E}`),
  duration: re(`(?<![\\d.])(\\d{1,3}(?:[.,]\\d)?)\\s*(${MIN_UNIT}|${SEC_UNIT})${E}`),
  clock: /(?<![\d.:])(\d{1,2}):(\d{2})(?![\d:])/u,
  field: re(`^(${RANGE})$`),
  comment: re(
    `${B}(?:heavy|light|slow|slowly|paused?|explosive|controlled|warm-?up sets?|dropsets?|drop sets?|важко|легко|повільно|вибухово|тяжело|медленно|взрывно)${E}`,
  ),
}

const clampSets = (n: number) => Math.min(MAX_SETS, Math.max(1, Math.round(n) || 1))
const clampRir = (n: number) => Math.min(RIR_MAX, Math.max(0, Math.round(n)))
const cleanReps = (s: string) => s.replace(/\s+/g, '').replace(/[–—]/g, '-').slice(0, REPS_MAX) || undefined
const num = (s: string) => Number(s.replace(',', '.'))
const isMinutes = (unit: string) => re(`^${MIN_UNIT}$`).test(unit.toLowerCase().trim())

/** "2 min", "90s", "1:30", "90". A bare number up to 10 reads as minutes, above that as seconds. */
export function parseDuration(value: string, unit?: string): number | undefined {
  const n = num(value)
  if (!Number.isFinite(n)) return undefined
  const u = (unit ?? '').toLowerCase().trim()
  if (u.startsWith(':')) return clampRest(n * 60 + Number(u.slice(1)))
  const minutes = u ? isMinutes(u) : n <= 10
  return clampRest(minutes ? n * 60 : n)
}

function restFromText(text: string): number | undefined {
  const clock = RX.clock.exec(text)
  if (clock) return clampRest(Number(clock[1]) * 60 + Number(clock[2]))
  const m = re(`^\\s*(\\d{1,3}(?:[.,]\\d)?)\\s*(${MIN_UNIT}|${SEC_UNIT})?\\s*$`).exec(text)
  return m ? parseDuration(m[1], m[2]) : undefined
}

/** "10/8/6" or "8-12": the lowest and highest target as a range. */
function repsOf(scheme: string): string | undefined {
  const parts = scheme.split(/\s*[/,]\s*/).map(Number)
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return cleanReps(scheme)
  const lo = Math.min(...parts)
  const hi = Math.max(...parts)
  return lo === hi ? String(lo) : `${lo}-${hi}`
}

/** Seconds as a timed target: "45s". */
const timed = (value: string, unit: string) => {
  const n = num(value)
  return `${Math.round(isMinutes(unit) ? n * 60 : n)}s`
}

// Removed matches leave this behind, so the text splits into the parts around the numbers.
const MARK = '\u0001'

type Fields = Omit<ParsedLine, 'raw' | 'name' | 'withPrev'>

/** Cuts a match out of the text. */
function take(text: string, rx: RegExp): [RegExpExecArray | null, string] {
  const m = rx.exec(text)
  if (!m) return [null, text]
  return [m, `${text.slice(0, m.index)} ${MARK} ${text.slice(m.index + m[0].length)}`]
}

const hasLetters = (s: string) => /\p{L}{2,}/u.test(s)

// Words left at the edge of a name once the numbers are gone: "Bench x", "по", "of".
const EDGE = /^(?:[xх×*@+&/]|по|of|by|with|for)(?:\s+|$)|(?:^|\s+)(?:[xх×*@+&/]|по|of|by|with|for)$/iu

function cleanName(s: string): string {
  let t = s
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:|@\-–—.]+|[\s,;:|@\-–—.]+$/g, '')
    .replace(/\s*,(\s*,)+\s*/g, ', ')
    .trim()
  for (let prev = ''; prev !== t; ) {
    prev = t
    t = t.replace(EDGE, '').replace(/^[\s,;:|\-–—.]+|[\s,;:|\-–—.]+$/g, '').trim()
  }
  return t
}

/**
 * The first part with words is the name. A few plain words right after the numbers stay with it
 * ("Pulldown 3x10 wide grip"); notes in brackets or after a separator do not.
 */
function pickName(parts: readonly string[]): string {
  const at = parts.findIndex((p) => hasLetters(cleanName(p)))
  if (at < 0) return ''
  const words = [cleanName(parts[at])]
  for (const p of parts.slice(at + 1)) {
    const t = p.trim()
    if (!t) continue
    if (!/^\p{L}[\p{L}ʼ'’\s-]*$/u.test(t) || t.split(/\s+/).length > 3) break
    words.push(t)
  }
  return cleanName(words.join(' '))
}

/** Unicode clean-up that every line gets first: odd spaces, emoji, full-width digits. */
export function normalizeText(s: string): string {
  return s
    .replace(/[^№]+/g, (part) => part.normalize('NFKC'))
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/\u200B|\u200C|\u200D|\u2060|\uFE0E|\uFE0F/g, '')
    .replace(/\p{Extended_Pictographic}|[✓☐☑☒✗✘▪▫►▶]/gu, ' ')
    .replace(/[ \t]+$/g, '')
}

type Tag = { group: string; index: number }

/** Bullets, checkboxes and superset labels ("A1.", "SS:") off the front of a line. */
function stripLead(line: string): { text: string; tag?: Tag } {
  let text = normalizeText(line).trim()
  for (let prev = ''; prev !== text; ) {
    prev = text
    text = text.replace(RX.bullet, '')
  }
  const s = RX.superset.exec(text)
  if (!s) return { text }
  const tag = s[1] ? { group: s[1].toUpperCase(), index: Number(s[2]) } : { group: 'SS', index: 0 }
  return { text: text.slice(s[0].length), tag }
}

/** The fields of one line and its name: the first part around the numbers that has words in it. */
function readLine(raw: string): { line: ParsedLine; tag?: Tag } | null {
  const lead = stripLead(raw)
  let text = lead.text
  const out: Fields = {}
  let m: RegExpExecArray | null
  const setRir = (n: number) => {
    if (out.rir === undefined) out.rir = clampRir(n)
  }

  ;[m, text] = take(text, RX.rir)
  if (m) setRir(Number(m[1]))
  ;[m, text] = take(text, RX.inReserve)
  if (m) setRir(Number(m[1]))
  ;[m, text] = take(text, RX.rpe)
  if (m) setRir(10 - num(m[1]))

  ;[m, text] = take(text, RX.rest)
  if (m) out.restSec = parseDuration(m[1], m[2])
  else {
    ;[m, text] = take(text, RX.restAfter)
    if (m) out.restSec = parseDuration(m[1], m[2])
  }
  for (const rx of [RX.tempo, RX.side, RX.comment]) {
    while (rx.test(text)) [, text] = take(text, rx)
  }
  while (RX.weight.test(text)) [, text] = take(text, RX.weight)
  // Distance is not a rep or a time target: "Farmer's walk 3x40m" keeps its sets only.
  const moving = RX.moving.test(text)
  ;[m, text] = take(text, moving ? RX.setsDistMoving : RX.setsDist)
  if (m) out.sets = clampSets(Number(m[1]))
  const dist = moving ? RX.distMoving : RX.dist
  while (dist.test(text)) [, text] = take(text, dist)

  ;[m, text] = take(text, RX.failTimes)
  if (m) {
    out.sets = clampSets(Number(m[1]))
    setRir(0)
  }
  while (RX.fail.test(text)) {
    ;[, text] = take(text, RX.fail)
    setRir(0)
  }

  if (out.sets === undefined) readSetsAndReps()
  if (out.reps === undefined) {
    ;[m, text] = take(text, RX.repsOnly)
    if (m) out.reps = cleanReps(m[1])
  }

  // "Face pull, 3, 12-15": bare numeric fields fill sets, then reps.
  const pieces = text.split(/([,;|\t])/)
  if (pieces.filter((p) => p.trim() && !/^[,;|\t]$/.test(p)).length > 1) {
    text = pieces
      .map((p) => {
        const f = p.trim()
        if (!RX.field.test(f)) return p
        if (out.sets === undefined && /^\d+$/.test(f)) out.sets = clampSets(Number(f))
        else if (out.reps === undefined) out.reps = cleanReps(f)
        else return p
        return ` ${MARK} `
      })
      .join('')
  }

  // "@2" reads as reps in reserve, "@8" as RPE, "@80" as a weight.
  ;[m, text] = take(text, RX.at)
  if (m && num(m[1]) <= 10) setRir(num(m[1]) > RIR_MAX ? 10 - num(m[1]) : num(m[1]))

  // A time with no reps is the work ("Plank 60s"); with reps it is the rest.
  const timeFor = (sec: number | undefined, label: string) => {
    if (sec === undefined) return
    if (out.reps === undefined) out.reps = label
    else if (out.restSec === undefined) out.restSec = sec
  }
  ;[m, text] = take(text, RX.clock)
  if (m) {
    const sec = Number(m[1]) * 60 + Number(m[2])
    timeFor(clampRest(sec), `${sec}s`)
  }
  ;[m, text] = take(text, RX.duration)
  if (m) timeFor(parseDuration(m[1], m[2]), timed(m[1], m[2]))

  const name = pickName(text.split(MARK))
  if (!hasLetters(name)) return null
  return { line: { raw: raw.trim(), name, ...strip(out) }, ...(lead.tag ? { tag: lead.tag } : {}) }

  function readSetsAndReps() {
    // "100x5x5": a weight, then sets and reps; "3x10x50": sets, reps, then a weight.
    ;[m, text] = take(text, RX.triple)
    if (m) {
      const [a, b, c] = [num(m[1]), Number(m[2]), Number(m[3])]
      let [sets, reps] = a > SETS_FIRST_MAX ? [b, c] : [a, b]
      // "16x3x12" is most likely a light weight first, but 16 sets is possible, so it gets a check.
      if (a > SETS_FIRST_MAX && a <= MAX_SETS) {
        if (sets > SETS_FIRST_MAX && reps <= SETS_FIRST_MAX) [sets, reps] = [reps, sets]
        out.unsure = true
      }
      out.sets = clampSets(sets)
      out.reps = String(reps)
      return
    }
    // "60x10, 70x8, 80x6": a log of weight x reps, one pair per set.
    const pairs = [...text.matchAll(RX.pair)]
    if (pairs.length >= 2 && pairs.every((p) => num(p[1]) > MAX_SETS)) {
      for (const p of pairs.reverse()) text = `${text.slice(0, p.index)} ${MARK} ${text.slice(p.index + p[0].length)}`
      out.sets = clampSets(pairs.length)
      out.reps = repsOf(pairs.map((p) => p[2]).join('/'))
      return
    }
    ;[m, text] = take(text, RX.setsTimes)
    if (m) {
      const a = Number(m[1])
      const target = m[2]
      const unit = m[3] && !re(`^${REPS_WORD}$`).test(m[3]) ? m[3] : undefined
      const single = /^\d+$/.test(target) ? Number(target) : null
      if (a > MAX_SETS) out.reps = single !== null ? String(single) : cleanReps(target)
      else if (single !== null && a >= 10 && single <= 5 && !unit) {
        // "12x3" in older notes means 12 reps for 3 sets.
        out.sets = clampSets(single)
        out.reps = String(a)
      } else {
        out.sets = clampSets(a)
        out.reps = unit && single !== null ? timed(target, unit) : /[/,]/.test(target) ? repsOf(target) : cleanReps(target)
      }
      return
    }
    ;[m, text] = take(text, RX.setsOf)
    if (m) {
      out.sets = clampSets(Number(m[1]))
      out.reps = cleanReps(m[2])
      return
    }
    ;[m, text] = take(text, RX.scheme)
    if (m) {
      const parts = m[1].split(/\s*[/-]\s*/)
      out.sets = clampSets(parts.length)
      out.reps = repsOf(parts.join('/'))
      return
    }
    ;[m, text] = take(text, RX.setsOnly)
    if (m) out.sets = clampSets(Number(m[1]))
  }
}

/** One exercise line; null when no name is left. */
export function parseLine(raw: string): ParsedLine | null {
  return readLine(raw)?.line ?? null
}

function strip(f: Fields): Fields {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Fields
}

type Header = {
  day: DayIndex | null
  label?: string
  rest: boolean
  /** Exercises written on the header line itself. */
  lines?: ParsedLine[]
  also?: DayIndex[]
  /** A bare "Label:" that reads as a section ("Warm-up:") when a day is already open. */
  section?: true
}

const MONTH = `(?:січ|лют|бер|квіт|трав|черв|лип|серп|вер|жовт|лист|груд|янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)${L}*\\.?`
const DATE = re(`${B}(?:\\d{1,2}[./]\\d{1,2}(?:[./]\\d{2,4})?|\\d{1,2}\\s+${MONTH}(?:\\s+\\d{4})?|${MONTH}\\s+\\d{1,2})${E}`, 'giu')

const label = (s: string | undefined) => {
  const t = s
    ?.replace(DATE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:\-–—.,/|()]+|[\s:\-–—.,/|()]+$/g, '')
    .slice(0, LABEL_MAX)
    .trim()
  return t || undefined
}

function weekdayOf(word: string): DayIndex | null {
  return WEEKDAY.get(fold(word).replace(/\.$/, '')) ?? null
}

const WEEKDAY_WORD = /^([\p{L}ʼ'’`]+)\.?(?=$|[\s:\-–—,/(|&+])(.*)$/u

/** A weekday, "Day 1", "Day A", "Push:", "# Upper", "**Legs**", or a rest marker. */
export function parseHeader(rawLine: string): Header | null {
  let line = stripLead(rawLine).text.replace(/^(?:on|в|у|во)\s+(?=\p{L})/iu, '')
  let marked = false
  const md = /^#{1,6}\s+(.*)$/u.exec(line) ?? /^\*\*(.+)\*\*:?$/u.exec(line) ?? /^__(.+)__:?$/u.exec(line)
  if (md) {
    line = md[1].trim()
    marked = true
  }
  const f = fold(line)
  if (REST_WORDS.test(f.replace(/:$/, ''))) return { day: null, rest: true }

  const wd = WEEKDAY_WORD.exec(line)
  const day = wd ? weekdayOf(wd[1]) : null
  if (wd && day !== null) {
    let tail = wd[2]
    // "Mon/Thu", "Пн і Чт": the same session on more than one day.
    const also: DayIndex[] = []
    for (;;) {
      const more = /^\s*(?:[/,&+]|and|і|й|та|и)\s*([\p{L}ʼ'’`]+)\.?(?=$|[\s:\-–—,/(|&+])(.*)$/iu.exec(tail)
      const next = more ? weekdayOf(more[1]) : null
      if (!more || next === null) break
      if (next !== day && !also.includes(next)) also.push(next)
      tail = more[2]
    }
    const extra = also.length ? { also } : {}
    tail = tail.replace(DATE, ' ').trim()
    const tailFold = fold(label(tail) ?? '')
    if (REST_WORDS.test(tailFold)) return { day, rest: true, ...extra }
    const lines = tailLines(tail.replace(/^[\s:\-–—,/|]+/, ''))
    if (lines) return { day, rest: false, lines, ...extra }
    return { day, label: label(tail), rest: false, ...extra }
  }

  const numbered =
    /^(?:day|день|workout|session|training|тренування|тренировка|заняття|занятие|сесія|сессия)\s*(?:№|#|no\.?)?\s*(\d{1,2}|[a-gа-г])(?![\p{L}\d])(.*)$/iu.exec(
      line,
    ) ?? /^(\d{1,2})(?:-?(?:й|ий|st|nd|rd|th))?\s+(?:day|день|тренування|тренировка)(?![\p{L}\d])(.*)$/iu.exec(line)
  if (numbered) {
    const tail = label(numbered[2])
    if (tail && REST_WORDS.test(fold(tail))) return { day: null, rest: true }
    return { day: null, label: tail ?? label(line.slice(0, line.length - numbered[2].length)), rest: false }
  }

  const colon = /^(.{1,30}):$/u.exec(line)
  if (colon && hasLetters(colon[1]) && !RX.setsTimes.test(colon[1])) return { day: null, label: label(colon[1]), rest: false, section: true }
  if (marked && hasLetters(line)) return { day: null, label: label(line), rest: false, section: true }
  return null
}

const hasTarget = (l: ParsedLine) => l.sets !== undefined || l.reps !== undefined

/**
 * Exercises after a weekday ("Monday: Bench 3x8, Squat 3x5"), or null when the tail is a session name.
 * A comma list counts when every part reads as an exercise and they all have numbers or none do.
 */
function tailLines(tail: string): ParsedLine[] | null {
  if (!tail) return null
  const parts = tail.split(/\s*[,;]\s+|\s*;\s*/).filter((p) => p.trim())
  if (parts.length > 1 && !isSessionLabel(tail)) {
    const lines = parts.map((p) => parseLine(p))
    const all = lines.every((l): l is ParsedLine => !!l)
    if (all && (lines.every(hasTarget) || lines.every((l) => !hasTarget(l) && !/\d/.test(l.raw)))) return lines.flatMap(splitPair)
  }
  const one = /\d/.test(tail) ? parseLine(tail) : null
  return one && hasTarget(one) ? splitPair(one) : null
}

// Words that name a session rather than an exercise, so "Push day" or "Груди + трицепс" alone on a line is a header.
const SESSION_WORDS = new Set(
  (
    'push pull legs leg upper lower full body fullbody chest back arms shoulders delts biceps triceps bis tris glutes ' +
    'hamstrings hams quads core abs calves posterior anterior day workout session training a b c d and ' +
    'груди грудь спина ноги ніг руки рук плечі плечей плечи дельти дельты біцепс бицепс трицепс сідниці ягодицы ' +
    'прес пресс корпус верх низ фулбаді фулбади тіло тело день тренування тренировка і й та и на ікри икры литки'
  ).split(' '),
)

function isSessionLabel(line: string): boolean {
  const words = fold(stripLead(line).text)
    .split(/[\s,&+/\-–—()]+/)
    .filter(Boolean)
  return words.length > 0 && words.length <= 5 && words.some((w) => w.length > 1) && words.every((w) => SESSION_WORDS.has(w) || /^\d$/.test(w))
}

const WEEK = re(`^(?:week|тиждень|неделя)\\s*\\d+.*$`)
const NOISE = re(`^(?:[\\p{P}\\p{S}\\s]*|notes?:?|нотатки:?|заметки:?|${DATE.source}[\\s,.]*)$`)

const unmark = (line: string) => line.replace(/^#{1,6}\s+|^(\*\*|__)|(\*\*|__):?$/g, '').trim()
const isWeek = (line: string) => WEEK.test(line) || WEEK.test(unmark(line))
const isNoise = (line: string) => isWeek(line) || NOISE.test(line) || NOISE.test(unmark(line))

// Parts of one session ("Warm-up:", "Main:") rather than sessions of their own.
const SECTION = re(
  '^(?:warm[- ]?ups?|main(?: (?:lifts?|work|part|block))?|strength|accessor(?:y|ies)(?: work)?|assistance|finisher|conditioning|' +
    'cool[- ]?down|mobility|stretch(?:ing)?|super ?sets?|tri-?sets?|giant sets?|circuit|' +
    'розминка|основн\\p{L}*(?: частина)?|допоміжн\\p{L}*(?: вправи)?|аксесуари|фінішер|заминка|розтяжка|суперсет\\p{L}*|трисет\\p{L}*|кругов\\p{L}*|коло|' +
    'разминка|основн\\p{L}*(?: часть)?|вспомогательн\\p{L}*|финишер|растяжка|круг)(?: \\d)?$',
)
const PAIR_SECTION = re('^(?:super ?sets?|суперсет\\p{L}*|супер-сет\\p{L}*)(?: \\d)?$')

// CSV

const HEADERS: Record<string, readonly string[]> = {
  day: ['day', 'weekday', 'session', 'день', 'тренування', 'тренировка'],
  name: ['exercise', 'name', 'movement', 'вправа', 'назва', 'упражнение', 'название'],
  sets: ['sets', 'set', 'підходи', 'підходів', 'підх', 'подходы', 'подходов'],
  reps: ['reps', 'rep', 'repetitions', 'повторення', 'повт', 'повторения', 'повторы'],
  rest: ['rest', 'rest sec', 'rest (s)', 'rest (sec)', 'rest (min)', 'відпочинок', 'отдых'],
  rir: ['rir', 'зп'],
}
type Column = keyof typeof HEADERS

export function splitCsvRow(row: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < row.length; i++) {
    const c = row[i]
    if (quoted) {
      if (c === '"' && row[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"' && !cur.trim()) {
      quoted = true
      cur = ''
    } else if (c === sep) {
      out.push(cur.trim())
      cur = ''
    } else cur += c
  }
  out.push(cur.trim())
  return out
}

function csvColumns(line: string): { sep: string; cols: (Column | null)[] } | null {
  let best: { sep: string; cols: (Column | null)[]; known: number } | null = null
  for (const sep of ['\t', ';', ',']) {
    const cells = splitCsvRow(line, sep)
    if (cells.length < 2) continue
    const cols = cells.map((c) => {
      const f = fold(c)
      return (Object.keys(HEADERS) as Column[]).find((k) => HEADERS[k].includes(f)) ?? null
    })
    const known = cols.filter(Boolean).length
    if (cols.includes('name') && known >= 2 && (!best || known > best.known)) best = { sep, cols, known }
  }
  return best
}

function parseCsv(lines: readonly string[], sep: string, cols: readonly (Column | null)[], warnings: ImportWarning[]): ParsedDay[] {
  const days: ParsedDay[] = []
  let lastKey: string | null = null
  lines.forEach((row, i) => {
    if (!row.trim()) return
    const cells = splitCsvRow(row, sep)
    const cell = (c: Column) => {
      const at = cols.indexOf(c)
      return at >= 0 ? (cells[at] ?? '').trim() : ''
    }
    const name = cleanName(cell('name'))
    const dayCell = cell('day')
    const key = fold(dayCell)
    if (!days.length || (dayCell && key !== lastKey)) {
      const h = dayCell ? parseHeader(dayCell) : null
      const lbl = h ? h.label : /^\d+$/.test(dayCell) ? undefined : label(dayCell)
      days.push({ day: h?.day ?? null, rest: !!h?.rest && !name, lines: [], ...(lbl ? { label: lbl } : {}) })
      lastKey = key
    }
    if (!name) return
    if (!hasLetters(name)) {
      warnings.push({ kind: 'unreadable', line: i + 2, raw: row.trim() })
      return
    }
    const sets = Number(cell('sets').replace(',', '.'))
    const repsCell = cell('reps')
    const restCell = cell('rest')
    const rirCell = cell('rir')
    // A "3x10" written in the reps column.
    const sx = !cell('sets') && repsCell ? RX.setsTimes.exec(repsCell) : null
    const scheme = sx ? { sets: clampSets(Number(sx[1])), reps: cleanReps(sx[2]) } : null
    const line: ParsedLine = {
      raw: row.trim(),
      name,
      ...strip({
        sets: cell('sets') && Number.isFinite(sets) ? clampSets(sets) : scheme?.sets,
        reps: scheme ? scheme.reps : repsCell ? cleanReps(repsCell) : undefined,
        restSec: restCell ? restFromText(restCell) : undefined,
        rir: rirCell && Number.isFinite(Number(rirCell)) ? clampRir(Number(rirCell)) : undefined,
      }),
    }
    const d = days[days.length - 1]
    d.lines.push(line)
    d.rest = false
  })
  return days
}

/** "Curl + Pushdown 3x12": two exercises sharing one line, done as a superset. */
function splitPair(line: ParsedLine): ParsedLine[] {
  const parts = line.name.split(/\s+\+\s+|(?<=\p{L})\+(?=\p{L})/u).map(cleanName)
  if (parts.length < 2 || !parts.every(hasLetters)) return [line]
  return parts.map((name, i) => ({ ...line, name, ...(i === 1 ? { withPrev: true as const } : {}) }))
}

/** Free text or CSV with a header row into days and lines. Unreadable lines become warnings. */
export function parseProgramText(input: string): ParsedText {
  const warnings: ImportWarning[] = []
  let text = input.replace(/\r\n?/g, '\n')
  if (text.length > IMPORT_MAX_CHARS) {
    text = text.slice(0, IMPORT_MAX_CHARS)
    warnings.push({ kind: 'truncated' })
  }
  let lines = text.split('\n')
  if (lines.length > IMPORT_MAX_LINES) {
    lines = lines.slice(0, IMPORT_MAX_LINES)
    if (!warnings.length) warnings.push({ kind: 'truncated' })
  }

  const first = lines.findIndex((l) => l.trim())
  const csv = first >= 0 ? csvColumns(lines[first]) : null
  if (csv) return { days: parseCsv(lines.slice(first + 1), csv.sep, csv.cols, warnings), warnings }

  const days: ParsedDay[] = []
  const also = new Map<ParsedDay, DayIndex[]>()
  const current = () => days[days.length - 1]
  const open = (h: Omit<ParsedDay, 'lines'>) => {
    days.push({ ...h, lines: [] })
  }
  let prevTag: Tag | undefined
  // The open day came from a weekday or "Day 1", so a bare "Label:" inside it is a section.
  let anchored = false
  let pairSection = false

  // "Week 2", or the weekdays coming round again, starts the next week; only the first is read.
  let week = 0
  let weekContent = false
  let weekHeader = false
  let skippedWeeks = 0
  const nextWeek = () => {
    if (week > 0 && weekContent) skippedWeeks++
    week++
    weekContent = false
  }

  const clean = lines.map((l) => normalizeText(l).trim())
  const content = clean.map((_, i) => i).filter((i) => !isNoise(clean[i]))
  const repeats = weekRepeats(clean)
  const firstWeek = clean.findIndex(isWeek)
  // "My program" on top of notes that then start with a day: a title, not an exercise.
  const title = content.length > 1 && content[1] > content[0] + 1 && !/\d/.test(clean[content[0]]) && !parseHeader(clean[content[0]]) && !!parseHeader(clean[content[1]]) ? content[0] : -1
  clean.forEach((raw, i) => {
    if (i === title) return
    if (isWeek(raw)) {
      if (weekContent) nextWeek()
      weekHeader = true
      return
    }
    if (isNoise(raw)) return
    const h: Header | null = parseHeader(raw) ?? (isSessionLabel(raw) ? { day: null, label: label(stripLead(raw).text), rest: false, section: true } : null)
    if (repeats.has(i)) nextWeek()
    // Intro lines before "Week 1" ("5/3/1 BBB", "Goal: strength") do not make it a second week.
    if ((h && !h.section) || weekHeader) weekContent = true
    if (week > 0) return
    if (h) {
      prevTag = undefined
      const cur = current()
      const section = h.section ? fold(h.label ?? '') : null
      if (section !== null && cur && !cur.rest && (anchored || SECTION.test(section))) {
        pairSection = PAIR_SECTION.test(section)
        if (!cur.label && !cur.lines.length && !SECTION.test(section)) cur.label = h.label
        return
      }
      pairSection = false
      anchored = !h.section
      // "Monday:" then "Rest" marks that day; a lone "Rest" is a day of its own.
      if (h.rest && h.day === null && cur && !cur.lines.length && !cur.rest) {
        cur.rest = true
        return
      }
      open({ day: h.day, rest: h.rest, ...(h.label ? { label: h.label } : {}) })
      if (h.also) also.set(current(), h.also)
      if (h.lines) current().lines.push(...h.lines)
      return
    }
    const read = readLine(raw)
    // A program name or goal above "Week 1" is not an exercise; one with numbers is shown to check.
    const intro = !days.length && i < firstWeek
    if (!read || (intro && hasTarget(read.line))) {
      warnings.push({ kind: 'unreadable', line: i + 1, raw })
      return
    }
    if (intro) return
    if (!days.length || current().rest) {
      open({ day: null, rest: false })
      anchored = false
    }
    const cur = current()
    const [head, ...rest] = splitPair(read.line)
    const tag = read.tag ?? (pairSection ? { group: 'SS', index: 0 } : undefined)
    const pairsWithPrev =
      !!tag && !!prevTag && cur.lines.length > 0 && !cur.lines[cur.lines.length - 1].withPrev &&
      (tag.group === 'SS' ? prevTag.group === 'SS' : tag.group === prevTag.group && tag.index === prevTag.index + 1)
    cur.lines.push(pairsWithPrev ? { ...head, withPrev: true } : head, ...rest)
    prevTag = rest.length ? undefined : tag && pairsWithPrev && tag.group === 'SS' ? undefined : tag
  })

  nextWeek()
  if (skippedWeeks) warnings.push({ kind: 'extra_weeks', count: skippedWeeks })
  for (const [d, more] of also) {
    for (const day of more) days.push({ ...d, day, lines: d.lines.map((l) => ({ ...l })) })
  }
  return { days: days.filter((d) => d.rest || d.lines.length || d.day !== null || d.label), warnings }
}

/**
 * Weekday headers that start a later week: a weekday seen before, followed by most of the first
 * week's days again. A lone repeat ("Monday PM", one more Monday) is another session that day.
 */
function weekRepeats(clean: readonly string[]): Set<number> {
  const seq: { i: number; day: DayIndex }[] = []
  const breaks = new Set<number>()
  clean.forEach((raw, i) => {
    if (isWeek(raw)) breaks.add(seq.length)
    if (isNoise(raw)) return
    const h = parseHeader(raw)
    if (h && h.day !== null) seq.push({ i, day: h.day })
  })
  const starts = new Set<number>()
  let week: DayIndex[] = []
  seq.forEach((s, k) => {
    if (breaks.has(k)) week = []
    if (!week.includes(s.day) || week[week.length - 1] === s.day) {
      if (!week.includes(s.day)) week.push(s.day)
      return
    }
    const next = new Set<DayIndex>()
    for (const t of seq.slice(k)) {
      if (next.has(t.day)) break
      next.add(t.day)
    }
    const again = [...next].filter((d) => week.includes(d)).length
    if (again >= 2 && again * 2 >= week.length) {
      starts.add(s.i)
      week = [...next]
    }
  })
  return starts
}

// Days

export type AssignedDay = Omit<ParsedDay, 'day'> & { day: DayIndex }

/** Training days for n sessions with no weekday given, spread like the templates. */
export const SPREAD: readonly (readonly DayIndex[])[] = [
  [],
  [0],
  [0, 3],
  [0, 2, 4],
  [0, 1, 3, 4],
  [0, 1, 2, 3, 4],
  [0, 1, 2, 3, 4, 5],
  [0, 1, 2, 3, 4, 5, 6],
]

/**
 * Weekday headers keep their day (repeats merge). The rest fill the free days: in order when the text
 * lists rest days, so the sequence is the week, otherwise spread over the week (3 sessions: Mon, Wed, Fri).
 * Sessions beyond the free days are dropped with a warning.
 */
export function assignDays(days: readonly ParsedDay[]): { days: AssignedDay[]; warnings: ImportWarning[] } {
  const byDay = new Map<DayIndex, AssignedDay>()
  for (const d of days) {
    if (d.day === null) continue
    const prev = byDay.get(d.day)
    if (!prev) byDay.set(d.day, { ...d, day: d.day, lines: [...d.lines] })
    else {
      prev.lines.push(...d.lines)
      prev.rest = prev.rest && d.rest && !prev.lines.length
      if (!prev.label && d.label) prev.label = d.label
    }
  }
  const loose = days.filter((d) => d.day === null)
  const free = [0, 1, 2, 3, 4, 5, 6].filter((d) => !byDay.has(d))
  const sequential = loose.some((d) => d.rest) || free.length < 7
  const slots = sequential ? free : (SPREAD[Math.min(loose.length, 7)] ?? free)
  const warnings: ImportWarning[] = []
  loose.forEach((d, i) => {
    const day = slots[i]
    if (day === undefined) return
    byDay.set(day, { ...d, day })
  })
  const dropped = loose.slice(slots.length).filter((d) => d.lines.length).length
  if (dropped) warnings.push({ kind: 'extra_days', count: dropped })
  return { days: [...byDay.values()].sort((a, b) => a.day - b.day), warnings }
}

// Program

export type ImportRef = ExerciseRef | { custom: CustomExerciseInput }

/** A match on another program's custom exercise comes along as a copy, so the new program holds no ref it cannot resolve. */
export function importRefFor(ref: ExerciseRef, sourceCustom: readonly CustomExercise[]): ImportRef | null {
  if (typeof ref !== 'string') return ref
  const found = sourceCustom.find((c) => c.id === ref)
  if (!found) return null
  const { id: _id, ...custom } = found
  return { custom }
}
export type ImportEntry = { ref: ImportRef; sets?: number; reps?: string; restSec?: number; rir?: number; withPrev?: boolean }
export type ImportDay = { day: DayIndex; label?: string; rest: boolean; entries: readonly ImportEntry[] }

/**
 * Days not listed are rest days. Custom exercises with the same name are created once; past the
 * custom limit their lines are left out. withPrev pairs an entry with the one above it when it can.
 */
export function buildImportedProgram(id: string, name: string, days: readonly ImportDay[], makeId: IdFactory, defaultSets = 3): Program {
  const training = days.filter((d) => !d.rest && d.entries.length).map((d) => d.day)
  let program = blankProgram(id, name, training.length ? training : [])
  const customIds = new Map<string, string>()
  for (const d of days) {
    if (d.rest) program = setRest(program, d.day)
    if (d.label) program = setLabel(program, d.day, d.label)
    for (const e of d.entries) {
      let ref: ExerciseRef
      if (typeof e.ref === 'object') {
        const key = fold(e.ref.custom.name)
        const known = customIds.get(key)
        if (known) ref = known
        else {
          const added = addCustomExercise(program, e.ref.custom)
          if (!added) continue
          program = added.program
          customIds.set(key, added.id)
          ref = added.id
        }
      } else ref = e.ref
      const before = program.days[d.day].entries.length
      program = addEntries(program, d.day, [ref], makeId, e.sets ?? defaultSets, e.reps)
      const entryId = program.days[d.day].entries[before]?.id
      if (!entryId) continue
      if (e.restSec !== undefined) program = setRestSec(program, entryId, e.restSec)
      if (e.rir !== undefined) program = setRir(program, entryId, e.rir)
      if (e.withPrev) program = linkWithPrev(program, entryId, true)
    }
  }
  return program
}

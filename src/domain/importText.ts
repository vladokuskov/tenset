import type { IdFactory } from './ids.ts'
import {
  LABEL_MAX,
  MAX_SETS,
  RIR_MAX,
  addCustomExercise,
  addEntries,
  blankProgram,
  clampRest,
  setLabel,
  setRest,
  setRestSec,
  setRir,
  type CustomExerciseInput,
} from './program.ts'
import type { ExerciseRef, Program } from './schema.ts'

export const IMPORT_MAX_CHARS = 20_000
export const IMPORT_MAX_LINES = 400
const REPS_MAX = 16

type DayIndex = number

export type ParsedLine = { raw: string; name: string; sets?: number; reps?: string; restSec?: number; rir?: number }
export type ParsedDay = { day: DayIndex | null; label?: string; rest: boolean; lines: ParsedLine[] }
export type ImportWarning =
  | { kind: 'unreadable'; line: number; raw: string }
  | { kind: 'truncated' }
  | { kind: 'extra_days'; count: number }
export type ParsedText = { days: ParsedDay[]; warnings: ImportWarning[] }

const fold = (s: string) => s.toLowerCase().replace(/[ʼ’'`]/g, 'ʼ').trim()

const WEEKDAYS: readonly (readonly string[])[] = [
  ['mon', 'monday', 'пн', 'пон', 'понеділок'],
  ['tue', 'tues', 'tuesday', 'вт', 'вів', 'вівторок'],
  ['wed', 'weds', 'wednesday', 'ср', 'сер', 'середа'],
  ['thu', 'thur', 'thurs', 'thursday', 'чт', 'чет', 'четвер'],
  ['fri', 'friday', 'пт', 'пʼят', 'пʼятниця', 'пятниця'],
  ['sat', 'saturday', 'сб', 'суб', 'субота'],
  ['sun', 'sunday', 'нд', 'нед', 'неділя'],
]
const WEEKDAY = new Map(WEEKDAYS.flatMap((names, day) => names.map((n) => [n, day] as const)))

const REST_WORDS = /^(?:rest(?: day)?|off|day off|відпочинок|день відпочинку|вихідний)\.?$/

const L = '\\p{L}'
const NUM = '\\d{1,3}'
const RANGE = `${NUM}(?:\\s*[-–—]\\s*${NUM})?`
const TIMES = '[xX×хХ*]'
const SETS_WORD = `(?:sets?|підх${L}*\\.?|сет${L}*)`
const REPS_WORD = `(?:reps?|повт${L}*\\.?|раз${L}*)`
const SEC_UNIT = `(?:s|secs?|seconds?|с|сек${L}*\\.?|"|”)`
const MIN_UNIT = `(?:m|mins?|minutes?|хв${L}*\\.?|'|’)`

// JS \b only knows ASCII letters, so word starts are spelled out.
const B = '(?<![\\p{L}\\d])'
const re = (src: string) => new RegExp(src, 'iu')

const RX = {
  bullet: /^\s*(?:[-*•·–—>]+|\d{1,2}[.)]|[a-zA-Z][.)])\s+/u,
  rir: re(`@?\\s*${B}(?:RIR|ЗП)\\s*[:=]?\\s*(\\d)(?:\\s*[-–]\\s*\\d)?`),
  rpe: re(`@?\\s*${B}RPE\\s*[:=]?\\s*(\\d{1,2}(?:[.,]5)?)`),
  at: re(`@\\s*(\\d{1,2}(?:[.,]5)?)(?![\\d\\p{L}])`),
  rest: re(
    `${B}(?:rest|відпочинок|відп\\.?|пауза)\\s*[:=]?\\s*(\\d{1,3}(?:[.,]\\d)?)(?:\\s*[-–]\\s*\\d{1,3}(?:[.,]\\d)?)?\\s*(${MIN_UNIT}|${SEC_UNIT}|:\\d{2})?(?![\\p{L}\\d])`,
  ),
  setsTimes: re(`(?<![\\d.])(\\d{1,2})\\s*${TIMES}\\s*(${RANGE})\\s*(?:${SEC_UNIT}|${REPS_WORD})?(?![\\p{L}\\d])`),
  setsOf: re(`(?<![\\d.])(\\d{1,2})\\s*${SETS_WORD}\\s*(?:of|x|×|х|по|,)?\\s*(${RANGE})\\s*(?:${REPS_WORD})?(?![\\p{L}\\d])`),
  repsOnly: re(`(?<![\\d.])(${RANGE})\\s*${REPS_WORD}(?![\\p{L}\\d])`),
  setsOnly: re(`(?<![\\d.])(\\d{1,2})\\s*${SETS_WORD}(?![\\p{L}\\d])`),
  duration: re(`(?<![\\d.])(\\d{1,3}(?:[.,]\\d)?)\\s*(${MIN_UNIT}|${SEC_UNIT})(?![\\p{L}\\d])`),
  clock: /(?<![\d.])(\d{1,2}):(\d{2})(?!\d)/u,
  field: re(`^(${RANGE})$`),
}

const clampSets = (n: number) => Math.min(MAX_SETS, Math.max(1, Math.round(n) || 1))
const clampRir = (n: number) => Math.min(RIR_MAX, Math.max(0, Math.round(n)))
const cleanReps = (s: string) => s.replace(/\s+/g, '').replace(/[–—]/g, '-').slice(0, REPS_MAX) || undefined
const num = (s: string) => Number(s.replace(',', '.'))

/** "2 min", "90s", "1:30", "90". A bare number up to 10 reads as minutes, above that as seconds. */
export function parseDuration(value: string, unit?: string): number | undefined {
  const n = num(value)
  if (!Number.isFinite(n)) return undefined
  const u = fold(unit ?? '')
  if (u.startsWith(':')) return clampRest(n * 60 + Number(u.slice(1)))
  const minutes = u ? re(`^${MIN_UNIT}$`).test(u) : n <= 10
  return clampRest(minutes ? n * 60 : n)
}

function restFromText(text: string): number | undefined {
  const clock = RX.clock.exec(text)
  if (clock) return clampRest(Number(clock[1]) * 60 + Number(clock[2]))
  const m = re(`^\\s*(\\d{1,3}(?:[.,]\\d)?)\\s*(${MIN_UNIT}|${SEC_UNIT})?\\s*$`).exec(text)
  return m ? parseDuration(m[1], m[2]) : undefined
}

type Fields = Omit<ParsedLine, 'raw' | 'name'>

/** Cuts a match out of the text so the rest becomes the name. */
function take(text: string, rx: RegExp): [RegExpExecArray | null, string] {
  const m = rx.exec(text)
  if (!m) return [null, text]
  return [m, `${text.slice(0, m.index)} , ${text.slice(m.index + m[0].length)}`]
}

const hasLetters = (s: string) => /\p{L}{2,}/u.test(s)

function cleanName(s: string): string {
  return s
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:|@\-–—.]+|[\s,;:|@\-–—.]+$/g, '')
    .replace(/\s*,(\s*,)+\s*/g, ', ')
    .trim()
}

/** One exercise line; null when no name is left. */
export function parseLine(raw: string): ParsedLine | null {
  let text = raw.replace(RX.bullet, '')
  const out: Fields = {}
  let m: RegExpExecArray | null

  ;[m, text] = take(text, RX.rir)
  if (m) out.rir = clampRir(Number(m[1]))
  if (out.rir === undefined) {
    ;[m, text] = take(text, RX.rpe)
    if (m) out.rir = clampRir(10 - num(m[1]))
  }
  ;[m, text] = take(text, RX.rest)
  if (m) out.restSec = parseDuration(m[1], m[2])

  ;[m, text] = take(text, RX.setsTimes)
  if (!m) [m, text] = take(text, RX.setsOf)
  if (m) {
    out.sets = clampSets(Number(m[1]))
    out.reps = cleanReps(m[2])
  } else {
    ;[m, text] = take(text, RX.setsOnly)
    if (m) out.sets = clampSets(Number(m[1]))
    ;[m, text] = take(text, RX.repsOnly)
    if (m) out.reps = cleanReps(m[1])
  }
  if (out.rir === undefined) {
    // "@2" reads as reps in reserve, "@8" as RPE.
    ;[m, text] = take(text, RX.at)
    if (m) out.rir = clampRir(num(m[1]) > RIR_MAX ? 10 - num(m[1]) : num(m[1]))
  }
  if (out.restSec === undefined) {
    ;[m, text] = take(text, RX.clock)
    if (m) out.restSec = clampRest(Number(m[1]) * 60 + Number(m[2]))
    else {
      ;[m, text] = take(text, RX.duration)
      if (m) out.restSec = parseDuration(m[1], m[2])
    }
  }

  // "Face pull, 3, 12-15": bare numeric fields fill sets, then reps.
  const fields = text.split(/[,;|\t]/).map((f) => f.trim())
  const kept: string[] = []
  for (const f of fields) {
    const n = RX.field.exec(f)
    if (n && fields.length > 1) {
      if (out.sets === undefined && /^\d+$/.test(f)) out.sets = clampSets(Number(f))
      else if (out.reps === undefined) out.reps = cleanReps(f)
      continue
    }
    if (f) kept.push(f)
  }
  const name = cleanName(kept.join(', '))
  if (!hasLetters(name)) return null
  return { raw: raw.trim(), name, ...strip(out) }
}

function strip(f: Fields): Fields {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Fields
}

type Header = { day: DayIndex | null; label?: string; rest: boolean; rest_of_line?: string }

const label = (s: string | undefined) => {
  const t = s?.replace(/^[\s:\-–—.,/|()]+|[\s:\-–—.,/|()]+$/g, '').slice(0, LABEL_MAX).trim()
  return t || undefined
}

function weekdayOf(word: string): DayIndex | null {
  return WEEKDAY.get(fold(word).replace(/\.$/, '')) ?? null
}

/** A weekday, "Day 1", "Day A", "Push:", "# Upper", "**Legs**", or a rest marker. */
export function parseHeader(rawLine: string): Header | null {
  let line = rawLine.trim().replace(RX.bullet, '')
  let marked = false
  const md = /^#{1,6}\s+(.*)$/u.exec(line) ?? /^\*\*(.+)\*\*:?$/u.exec(line) ?? /^__(.+)__:?$/u.exec(line)
  if (md) {
    line = md[1].trim()
    marked = true
  }
  const f = fold(line)
  if (REST_WORDS.test(f.replace(/:$/, ''))) return { day: null, rest: true }

  const wd = /^([\p{L}ʼ'’`]+)\.?(?=$|[\s:\-–—,/(|])(.*)$/u.exec(line)
  const day = wd ? weekdayOf(wd[1]) : null
  if (wd && day !== null) {
    const tail = wd[2].trim()
    const tailFold = fold(label(tail) ?? '')
    if (REST_WORDS.test(tailFold)) return { day, rest: true }
    const asLine = tail && /\d/.test(tail) ? parseLine(tail.replace(/^[\s:\-–—,/|]+/, '')) : null
    if (asLine && (asLine.sets !== undefined || asLine.reps !== undefined)) return { day, rest: false, rest_of_line: asLine.raw }
    return { day, label: label(tail), rest: false }
  }

  const numbered = /^(?:day|день|workout|session|тренування|сесія)\s*(\d{1,2}|[a-gа-г])(?![\p{L}\d])(.*)$/iu.exec(line)
  if (numbered) {
    const tail = label(numbered[2])
    if (tail && REST_WORDS.test(fold(tail))) return { day: null, rest: true }
    return { day: null, label: tail ?? label(line.slice(0, line.length - numbered[2].length)), rest: false }
  }

  const colon = /^(.{1,30}):$/u.exec(line)
  if (colon && hasLetters(colon[1]) && !RX.setsTimes.test(colon[1])) return { day: null, label: label(colon[1]), rest: false }
  if (marked && hasLetters(line)) return { day: null, label: label(line), rest: false }
  return null
}

const NOISE = /^(?:[\p{P}\p{S}\s]*|(?:week|тиждень)\s*\d+.*|notes?:?|нотатки:?)$/iu

// CSV

const HEADERS: Record<string, readonly string[]> = {
  day: ['day', 'weekday', 'session', 'день', 'тренування'],
  name: ['exercise', 'name', 'movement', 'вправа', 'назва'],
  sets: ['sets', 'set', 'підходи', 'підходів', 'підх'],
  reps: ['reps', 'rep', 'repetitions', 'повторення', 'повт'],
  rest: ['rest', 'rest sec', 'rest (s)', 'rest (sec)', 'rest (min)', 'відпочинок'],
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
    const line: ParsedLine = {
      raw: row.trim(),
      name,
      ...strip({
        sets: cell('sets') && Number.isFinite(sets) ? clampSets(sets) : undefined,
        reps: repsCell ? cleanReps(repsCell) : undefined,
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
  const current = () => days[days.length - 1]
  const open = (h: Omit<ParsedDay, 'lines'>) => {
    days.push({ ...h, lines: [] })
  }

  lines.forEach((rawLine, i) => {
    const raw = rawLine.trim()
    if (NOISE.test(raw)) return
    const h = parseHeader(raw)
    if (h) {
      const cur = current()
      // "Monday:" then "Rest" marks that day; a lone "Rest" is a day of its own.
      if (h.rest && h.day === null && cur && !cur.lines.length && !cur.rest) {
        cur.rest = true
        return
      }
      open({ day: h.day, rest: h.rest, ...(h.label ? { label: h.label } : {}) })
      if (h.rest_of_line) current().lines.push({ ...parseLine(h.rest_of_line)!, raw })
      return
    }
    const line = parseLine(raw)
    if (!line) {
      warnings.push({ kind: 'unreadable', line: i + 1, raw })
      return
    }
    if (!days.length || current().rest) open({ day: null, rest: false })
    current().lines.push(line)
  })
  return { days: days.filter((d) => d.rest || d.lines.length || d.day !== null || d.label), warnings }
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
export type ImportEntry = { ref: ImportRef; sets?: number; reps?: string; restSec?: number; rir?: number }
export type ImportDay = { day: DayIndex; label?: string; rest: boolean; entries: readonly ImportEntry[] }

/**
 * Days not listed are rest days. Custom exercises with the same name are created once; past the
 * custom limit their lines are left out.
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
    }
  }
  return program
}

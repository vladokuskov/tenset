import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { sequentialIds } from './ids.ts'
import { IMPORT_MAX_CHARS, assignDays, buildImportedProgram, parseLine, parseProgramText, type ParsedLine } from './importText.ts'
import { MAX_SETS, REST_MAX, REST_STEP, RIR_MAX } from './program.ts'
import { Program } from './schema.ts'

const NAMES = [
  'Bench press', 'Incline DB press', 'Lat pulldown', 'Romanian deadlift', 'Face pull', 'Leg press', 'Pull-ups', 'Hammer curl',
  'Жим лежачи', 'Присідання зі штангою', 'Тяга верхнього блоку', 'Махи в сторони', 'Віджимання на брусах', 'Румунська тяга',
  'Жим лежа', 'Приседания', 'Становая тяга', 'Подтягивания', 'Разводка гантелей',
]
const HEADERS = ['Monday', 'Wed:', 'Пн', 'Середа - ноги', 'Пятница (спина)', 'Day 1', 'Тренування 2', 'Push:', '## Legs', '**Arms**', 'Rest', 'Неділя: відпочинок', 'Upper', 'Груди + трицепс']

const n = (lo: number, hi: number) => fc.integer({ min: lo, max: hi })
const fields = fc.oneof(
  fc.tuple(n(1, 8), n(1, 30)).map(([s, r]) => `${s}x${r}`),
  fc.tuple(n(1, 8), n(1, 15), n(1, 5)).map(([s, a, b]) => `${s} × ${a}-${a + b}`),
  fc.tuple(n(1, 8), n(1, 20)).map(([s, r]) => `${s} по ${r}`),
  fc.tuple(n(1, 8), n(1, 20)).map(([s, r]) => `${s} sets of ${r} reps`),
  fc.tuple(n(1, 8), n(1, 20)).map(([s, r]) => `${s} підходи по ${r} повторень`),
  fc.tuple(n(3, 15), n(3, 15), n(1, 10)).map(([a, b, c]) => `${a}/${b}/${c}`),
  fc.tuple(n(1, 6), n(10, 90)).map(([s, t]) => `${s}x${t}s`),
  fc.tuple(n(30, 200), n(1, 10), n(1, 10)).map(([w, s, r]) => `${w}x${s}x${r}`),
  fc.tuple(n(1, 6), n(1, 3)).map(([s]) => `${s}x max`),
)
const extra = fc.oneof(
  fc.constant(''),
  n(5, 200).map((w) => `${w}kg`),
  n(0, 5).map((k) => `RIR ${k}`),
  n(6, 10).map((k) => `@${k}`),
  n(1, 5).map((t) => `rest ${t} min`),
  n(30, 180).map((t) => `відпочинок ${t}с`),
  fc.constantFrom('each leg', 'на кожну ногу', '(slow)', '- heavy', 'до відмови', 'tempo 3-1-1-0'),
)
const lead = fc.constantFrom('', '- ', '* ', '• ', '1. ', '2) ', '✅ ', '- [ ] ', 'A1. ', 'B2 ', 'SS: ', '💪 ')
const exerciseLine = fc
  .tuple(lead, fc.constantFrom(...NAMES), fields, extra, fc.boolean())
  .map(([l, name, f, x, first]) => (first ? `${l}${f} ${name} ${x}` : `${l}${name} ${f} ${x}`).trim())
const line = fc.oneof({ weight: 6, arbitrary: exerciseLine }, { weight: 2, arbitrary: fc.constantFrom(...HEADERS) }, { weight: 1, arbitrary: fc.constant('') })
const notes = fc.array(line, { maxLength: 40 }).map((ls) => ls.join('\n'))

function checkLine(l: ParsedLine) {
  expect(l.name).toMatch(/\p{L}{2}/u)
  expect(l.name.includes(String.fromCharCode(1))).toBe(false)
  expect(l.name).toBe(l.name.trim())
  if (l.sets !== undefined) {
    expect(Number.isInteger(l.sets)).toBe(true)
    expect(l.sets).toBeGreaterThanOrEqual(1)
    expect(l.sets).toBeLessThanOrEqual(MAX_SETS)
  }
  if (l.reps !== undefined) {
    expect(l.reps.length).toBeGreaterThan(0)
    expect(l.reps.length).toBeLessThanOrEqual(16)
  }
  if (l.restSec !== undefined) {
    expect(l.restSec % REST_STEP).toBe(0)
    expect(l.restSec).toBeGreaterThanOrEqual(0)
    expect(l.restSec).toBeLessThanOrEqual(REST_MAX)
  }
  if (l.rir !== undefined) {
    expect(Number.isInteger(l.rir)).toBe(true)
    expect(l.rir).toBeGreaterThanOrEqual(0)
    expect(l.rir).toBeLessThanOrEqual(RIR_MAX)
  }
}

describe('paste parser properties', () => {
  it('never throws on any text and keeps every field in range', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 600 }), (text) => {
        const parsed = parseProgramText(text)
        for (const d of parsed.days) d.lines.forEach(checkLine)
        assignDays(parsed.days)
      }),
      { numRuns: 500 },
    )
  })

  it('keeps every field in range for realistic notes', () => {
    fc.assert(
      fc.property(notes, (text) => {
        for (const d of parseProgramText(text).days) d.lines.forEach(checkLine)
      }),
      { numRuns: 500 },
    )
  })

  it('reads every exercise line it is given, with its sets', () => {
    fc.assert(
      fc.property(exerciseLine, (raw) => {
        const l = parseLine(raw)
        expect(l).not.toBeNull()
        expect(l!.sets ?? l!.reps).toBeDefined()
        // Nothing parseable is left in the name.
        const again = parseLine(l!.name)
        expect(again?.name).toBe(l!.name)
        expect(again?.sets).toBeUndefined()
        expect(again?.reps).toBeUndefined()
      }),
      { numRuns: 1000 },
    )
  })

  it('drops no exercise line silently', () => {
    fc.assert(
      fc.property(notes, (text) => {
        const parsed = parseProgramText(text)
        const seen = new Set(parsed.days.flatMap((d) => d.lines.map((l) => l.raw)))
        const warned = new Set(parsed.warnings.flatMap((w) => (w.kind === 'unreadable' ? [w.raw] : [])))
        // A weekday that comes round again starts a second week, which is left out with its own warning.
        const laterWeeks = parsed.warnings.some((w) => w.kind === 'extra_weeks')
        for (const raw of text.split('\n').map((l) => l.trim())) {
          if (!/\d\s*(?:[xх×]|по|sets|підх|\/)/u.test(raw)) continue
          const kept = [...seen].some((s) => s === raw || s.endsWith(raw) || raw.endsWith(s))
          expect(kept || warned.has(raw) || laterWeeks, raw).toBe(true)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('always builds a valid program', () => {
    fc.assert(
      fc.property(notes, (text) => {
        const { days } = assignDays(parseProgramText(text).days)
        const program = buildImportedProgram(
          'p',
          'Imported program',
          days.map((d) => ({
            day: d.day,
            label: d.label,
            rest: d.rest,
            entries: d.lines.map((l, i) => ({ ref: 101 + (i % 5), sets: l.sets, reps: l.reps, restSec: l.restSec, rir: l.rir, withPrev: l.withPrev })),
          })),
          sequentialIds('e'),
        )
        expect(Program.safeParse(program).success).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  it('stays fast on the largest input', () => {
    const big = Array.from({ length: 400 }, (_, i) => `${NAMES[i % NAMES.length]} 3x${(i % 12) + 1} rest 90s RIR 2`).join('\n').slice(0, IMPORT_MAX_CHARS)
    const start = performance.now()
    parseProgramText(big)
    expect(performance.now() - start).toBeLessThan(500)
  })
})

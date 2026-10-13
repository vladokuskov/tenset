import { describe, expect, it } from 'vitest'
import { sequentialIds } from './ids.ts'
import {
  IMPORT_MAX_CHARS,
  assignDays,
  buildImportedProgram,
  importRefFor,
  parseDuration,
  parseHeader,
  parseLine,
  parseProgramText,
  splitCsvRow,
  type ParsedDay,
} from './importText.ts'
import { Program, type CustomExercise } from './schema.ts'

const fields = (line: string) => {
  const p = parseLine(line)
  if (!p) return null
  const { raw: _raw, ...rest } = p
  return rest
}

describe('parseLine', () => {
  it.each([
    ['Bench press 3x8-10', { name: 'Bench press', sets: 3, reps: '8-10' }],
    ['Bench press 3 x 8', { name: 'Bench press', sets: 3, reps: '8' }],
    ['3x10 Lat pulldown', { name: 'Lat pulldown', sets: 3, reps: '10' }],
    ['Squat 5x5 @ RIR 2', { name: 'Squat', sets: 5, reps: '5', rir: 2 }],
    ['RDL 3x8 rest 2 min', { name: 'RDL', sets: 3, reps: '8', restSec: 120 }],
    ['Face pull, 3, 12-15, 60s, RIR 1', { name: 'Face pull', sets: 3, reps: '12-15', restSec: 60, rir: 1 }],
    ['4 sets of 10 squats', { name: 'squats', sets: 4, reps: '10' }],
    ['- Cable fly 3×15', { name: 'Cable fly', sets: 3, reps: '15' }],
    ['1. Dips 3 × 12', { name: 'Dips', sets: 3, reps: '12' }],
    ['• Жим лежачи 4х8', { name: 'Жим лежачи', sets: 4, reps: '8' }],
    ['Присідання 3 підх. по 10 повт', { name: 'Присідання', sets: 3, reps: '10' }],
    ['Leg press 3 sets 12 reps RPE 8', { name: 'Leg press', sets: 3, reps: '12', rir: 2 }],
    ['Row 3x10 @8', { name: 'Row', sets: 3, reps: '10', rir: 2 }],
    ['Row 3x10 @1', { name: 'Row', sets: 3, reps: '10', rir: 1 }],
    ['Lunge 3x10 1:30', { name: 'Lunge', sets: 3, reps: '10', restSec: 90 }],
    ['Тяга 3x10 відпочинок 90 с', { name: 'Тяга', sets: 3, reps: '10', restSec: 90 }],
    ['Pull-up', { name: 'Pull-up' }],
    // Ways of writing sets and reps
    ['Жим лежа 3 по 10', { name: 'Жим лежа', sets: 3, reps: '10' }],
    ['Згинання ніг 3 рази по 15', { name: 'Згинання ніг', sets: 3, reps: '15' }],
    ['Приседания 4 подхода по 8 повторений', { name: 'Приседания', sets: 4, reps: '8' }],
    ['10 reps x 3 sets cable fly', { name: 'cable fly', sets: 3, reps: '10' }],
    ['12x3 curls', { name: 'curls', sets: 3, reps: '12' }],
    ['Curl 8x3', { name: 'Curl', sets: 8, reps: '3' }],
    ['Bench 10/8/6', { name: 'Bench', sets: 3, reps: '6-10' }],
    ['Row 4x12,10,8,6', { name: 'Row', sets: 4, reps: '6-12' }],
    ['Squat 12-10-8', { name: 'Squat', sets: 3, reps: '8-12' }],
    // Weights are not part of the plan
    ['Bench 80kg 3x8', { name: 'Bench', sets: 3, reps: '8' }],
    ['Тяга гантелі по 24 кг 3х10', { name: 'Тяга гантелі', sets: 3, reps: '10' }],
    ['Squat 3x5 @ 75%', { name: 'Squat', sets: 3, reps: '5' }],
    ['Squat 100x5x5', { name: 'Squat', sets: 5, reps: '5' }],
    ['Row 60x10, 70x8, 80x6', { name: 'Row', sets: 3, reps: '6-10' }],
    ['Bench 3x8 @ 80', { name: 'Bench', sets: 3, reps: '8' }],
    // Failure, reserve, time
    ['Pull ups 3xAMRAP', { name: 'Pull ups', sets: 3, rir: 0 }],
    ['Підтягування 3х макс', { name: 'Підтягування', sets: 3, rir: 0 }],
    ['Squat 3x5 до відмови', { name: 'Squat', sets: 3, reps: '5', rir: 0 }],
    ['Тяга 3х10 2 в запасі', { name: 'Тяга', sets: 3, reps: '10', rir: 2 }],
    ['Plank 3x60s', { name: 'Plank', sets: 3, reps: '60s' }],
    ['Plank 3 x 1 min', { name: 'Plank', sets: 3, reps: '60s' }],
    ['Планка 45 сек', { name: 'Планка', reps: '45s' }],
    ['Dead hang 1:00', { name: 'Dead hang', reps: '60s' }],
    ['Row 3x10, 90s rest', { name: 'Row', sets: 3, reps: '10', restSec: 90 }],
    ['Жим 3х8 с отдыхом 2 мин', { name: 'Жим', sets: 3, reps: '8', restSec: 120 }],
    // What is left of the name
    ['A1. Bench 3x8', { name: 'Bench', sets: 3, reps: '8' }],
    ['✅ Leg press 4x12', { name: 'Leg press', sets: 4, reps: '12' }],
    ['- [ ] Face pull 3x15', { name: 'Face pull', sets: 3, reps: '15' }],
    ['Lunges 3x10 each leg', { name: 'Lunges', sets: 3, reps: '10' }],
    ['Випади 3х12 на кожну ногу', { name: 'Випади', sets: 3, reps: '12' }],
    ['Жим гантелей сидячи — 3×12 (повільно)', { name: 'Жим гантелей сидячи', sets: 3, reps: '12' }],
    ['Hack squat 3x8 - slow negatives', { name: 'Hack squat', sets: 3, reps: '8' }],
    ['Pulldown 3x10 wide grip', { name: 'Pulldown wide grip', sets: 3, reps: '10' }],
    ['Присед 3х5 с паузой', { name: 'Присед с паузой', sets: 3, reps: '5' }],
    ['Calf raise 4x15 tempo 3-1-1-0', { name: 'Calf raise', sets: 4, reps: '15' }],
    ['SS bar squat 3x5', { name: 'SS bar squat', sets: 3, reps: '5' }],
    ['Ｂench ３x８', { name: 'Bench', sets: 3, reps: '8' }],
  ])('%s', (line, want) => {
    expect(fields(line)).toEqual(want)
  })

  it('clamps sets, reps, rest and RIR', () => {
    expect(fields('Curl 20x10')?.sets).toBe(20)
    expect(fields('Curl 30x10')).toEqual({ name: 'Curl', reps: '10' })
    expect(fields('Curl 0x10')?.sets).toBe(1)
    expect(fields('Curl 3x10 rest 20 min')?.restSec).toBe(600)
    expect(fields('Curl 3x10 rest 50s')?.restSec).toBe(45)
    expect(fields('Curl 3x10 RIR 7')?.rir).toBe(5)
  })

  it('reads a light weight first in a triple and flags it for a check', () => {
    expect(fields('Goblet squat 16x3x12')).toEqual({ name: 'Goblet squat', sets: 3, reps: '12', unsure: true })
    expect(fields('DB curl 12x3x10')).toEqual({ name: 'DB curl', sets: 3, reps: '10', unsure: true })
    expect(fields('Bench 20x5x5')).toEqual({ name: 'Bench', sets: 5, reps: '5', unsure: true })
    expect(fields('Curl 14x12x3')).toEqual({ name: 'Curl', sets: 3, reps: '12', unsure: true })
    expect(fields('Squat 100x5x5')).toEqual({ name: 'Squat', sets: 5, reps: '5' })
    expect(fields('Curl 3x10x15')).toEqual({ name: 'Curl', sets: 3, reps: '10' })
  })

  it('reads metres as distance, never as minutes', () => {
    expect(fields("Farmer's walk 3x40m")).toEqual({ name: "Farmer's walk", sets: 3 })
    expect(fields('Sled push 4x20m')).toEqual({ name: 'Sled push', sets: 4 })
    expect(fields('Sled push 4 x 20 m rest 2m')).toEqual({ name: 'Sled push', sets: 4, restSec: 120 })
    expect(fields('Прогулянка фермера 3х40 м')).toEqual({ name: 'Прогулянка фермера', sets: 3 })
    expect(fields('Run 400m')).toEqual({ name: 'Run' })
    expect(fields('Bike 10 min')).toEqual({ name: 'Bike', reps: '600s' })
    expect(fields('Curl 3x10 2m rest')?.restSec).toBe(120)
  })

  it('returns null when no name is left', () => {
    expect(parseLine('3x10')).toBeNull()
    expect(parseLine('- 4 x 8')).toBeNull()
  })
})

describe('parseDuration', () => {
  it('reads units and bare numbers', () => {
    expect(parseDuration('90', 's')).toBe(90)
    expect(parseDuration('1.5', 'min')).toBe(90)
    expect(parseDuration('2', 'хв')).toBe(120)
    expect(parseDuration('2')).toBe(120)
    expect(parseDuration('90')).toBe(90)
  })
})

describe('parseHeader', () => {
  it.each([
    ['Monday', { day: 0, rest: false }],
    ['Tue', { day: 1, rest: false }],
    ['Mon: Push', { day: 0, label: 'Push', rest: false }],
    ['Пн', { day: 0, rest: false }],
    ['Четвер', { day: 3, rest: false }],
    ["П'ятниця - ноги", { day: 4, label: 'ноги', rest: false }],
    ['Day 1', { day: null, label: 'Day 1', rest: false }],
    ['Day A: Upper', { day: null, label: 'Upper', rest: false }],
    ['День 2', { day: null, label: 'День 2', rest: false }],
    ['Push:', { day: null, label: 'Push', rest: false, section: true }],
    ['Upper A:', { day: null, label: 'Upper A', rest: false, section: true }],
    ['## Legs', { day: null, label: 'Legs', rest: false, section: true }],
    ['**Arms**', { day: null, label: 'Arms', rest: false, section: true }],
    ['Rest', { day: null, rest: true }],
    ['Відпочинок', { day: null, rest: true }],
    ['Sunday: rest', { day: 6, rest: true }],
    ['Нд - відпочинок', { day: 6, rest: true }],
    ['Среда (ноги)', { day: 2, label: 'ноги', rest: false }],
    ['Вс - отдых', { day: 6, rest: true }],
    ['Пн 12.10 Upper', { day: 0, label: 'Upper', rest: false }],
    ["П'ятниця 12 жовтня", { day: 4, rest: false }],
    ['У вівторок', { day: 1, rest: false }],
    ['Mon/Thu: Upper', { day: 0, label: 'Upper', rest: false, also: [3] }],
    ['Пн і Чт - верх', { day: 0, label: 'верх', rest: false, also: [3] }],
    ['Тренировка А', { day: null, label: 'Тренировка А', rest: false }],
    ['Тренування №2', { day: null, label: 'Тренування №2', rest: false }],
    ['1-й день', { day: null, label: '1-й день', rest: false }],
  ])('%s', (line, want) => {
    expect(parseHeader(line)).toEqual(want)
  })

  it('leaves exercise lines alone', () => {
    expect(parseHeader('Bench press 3x8')).toBeNull()
    expect(parseHeader('Sumo deadlift 3x5')).toBeNull()
    expect(parseHeader('Plank')).toBeNull()
  })

  it('keeps an exercise written on the weekday line', () => {
    const t = parseProgramText('Monday: Bench 3x8\nRow 3x10')
    expect(t.days).toHaveLength(1)
    expect(t.days[0].day).toBe(0)
    expect(t.days[0].lines.map((l) => l.name)).toEqual(['Bench', 'Row'])
  })
})

describe('parseProgramText', () => {
  it('splits named sessions and warns on unreadable lines', () => {
    const t = parseProgramText('Push:\nBench press 3x8\nOverhead press 3x10\n\nPull:\nRow 4x10\n4x4\n\nLegs:\nSquat 5x5\n')
    expect(t.days.map((d) => [d.label, d.lines.length])).toEqual([
      ['Push', 2],
      ['Pull', 1],
      ['Legs', 1],
    ])
    expect(t.warnings).toEqual([{ kind: 'unreadable', line: 7, raw: '4x4' }])
  })

  it('reads weekdays and rest markers in both languages', () => {
    const t = parseProgramText('Пн\nЖим 3x8\nВт\nВідпочинок\nСр: ноги\nПрисідання 4x6\nSat\nRest')
    expect(t.days.map((d) => [d.day, d.rest, d.label ?? null, d.lines.length])).toEqual([
      [0, false, null, 1],
      [1, true, null, 0],
      [2, false, 'ноги', 1],
      [5, true, null, 0],
    ])
  })

  it('puts lines without a header into one day', () => {
    const t = parseProgramText('Squat 3x5\nBench 3x5\nRow 3x5')
    expect(t.days).toHaveLength(1)
    expect(t.days[0]).toMatchObject({ day: null, rest: false })
    expect(t.days[0].lines).toHaveLength(3)
  })

  it('skips noise lines', () => {
    const t = parseProgramText('Week 1\n---\nSquat 3x5\n\n***\n# Неделя 2\n12.10.2026\n💪💪')
    expect(t.warnings).toEqual([])
    expect(t.days[0].lines).toHaveLength(1)
  })

  it('reads a line of session words as a header, not as an exercise', () => {
    const t = parseProgramText('Push day\nBench 3x8\nСпина + біцепс\nТяга 3x8\nCalves 4x15\nBack extension')
    expect(t.days.map((d) => [d.label, d.lines.map((l) => l.name)])).toEqual([
      ['Push day', ['Bench']],
      ['Спина + біцепс', ['Тяга', 'Calves', 'Back extension']],
    ])
  })

  it('skips a title only when a blank line parts it from the first day', () => {
    expect(parseProgramText('My program\n\nMonday\nSquat 3x5').days.flatMap((d) => d.lines.map((l) => l.name))).toEqual(['Squat'])
    expect(parseProgramText('Squat\nMonday\nBench 3x5').days.flatMap((d) => d.lines.map((l) => l.name))).toEqual(['Squat', 'Bench'])
  })

  it('pairs supersets: A1/A2, SS: lines, and two names joined by +', () => {
    const pairs = (text: string) => parseProgramText(text).days[0].lines.map((l) => [l.name, !!l.withPrev])
    expect(pairs('A1 Curl 3x10\nA2 Pushdown 3x10\nA3 Wrist curl 3x10')).toEqual([
      ['Curl', false],
      ['Pushdown', true],
      ['Wrist curl', false],
    ])
    expect(pairs('SS: Curl 3x10\nSS: Pushdown 3x10\nSS: Fly 3x10')).toEqual([
      ['Curl', false],
      ['Pushdown', true],
      ['Fly', false],
    ])
    expect(pairs('B1 Curl 3x10\nRow 3x10\nB2 Pushdown 3x10').map(([, p]) => p)).toEqual([false, false, false])
    expect(parseProgramText('Curl + Pushdown 3x12').days[0].lines).toMatchObject([
      { name: 'Curl', sets: 3, reps: '12' },
      { name: 'Pushdown', sets: 3, reps: '12', withPrev: true },
    ])
  })

  it('copies a session written for two weekdays', () => {
    const t = assignDays(parseProgramText('Mon/Thu: Upper\nBench 3x8').days)
    expect(t.days.map((d) => [d.day, d.label, d.lines.length])).toEqual([
      [0, 'Upper', 1],
      [3, 'Upper', 1],
    ])
  })

  it('keeps section headers inside the weekday they belong to', () => {
    const t = assignDays(parseProgramText('Monday\nWarm-up:\nBike 10 min\nMain:\nSquat 3x5\nBench 3x8').days)
    expect(t.days.map((d) => [d.day, d.label ?? null, d.lines.map((l) => l.name)])).toEqual([[0, null, ['Bike', 'Squat', 'Bench']]])
    const c = assignDays(parseProgramText('Monday\nCircuit:\nBurpee 3x10\nSwing 3x15\nWednesday\nSquat 3x5').days)
    expect(c.days.map((d) => [d.day, d.lines.length])).toEqual([
      [0, 2],
      [2, 1],
    ])
  })

  it('pairs the lines under a Superset: section', () => {
    const t = parseProgramText('Monday\nSuperset:\nCurl 3x12\nPushdown 3x12\nFly 3x12\nRaise 3x12')
    expect(t.days.map((d) => [d.day, d.lines.map((l) => [l.name, !!l.withPrev])])).toEqual([
      [
        0,
        [
          ['Curl', false],
          ['Pushdown', true],
          ['Fly', false],
          ['Raise', true],
        ],
      ],
    ])
  })

  it('reads a section word as part of a named session, and a session word under a weekday as its name', () => {
    expect(parseProgramText('Push:\nWarm-up:\nBike 5 min\nBench 3x8').days.map((d) => [d.label, d.lines.length])).toEqual([['Push', 2]])
    expect(parseProgramText('Monday\nPush:\nBench 3x8').days.map((d) => [d.day, d.label, d.lines.length])).toEqual([[0, 'Push', 1]])
  })

  it('reads every exercise in a list on the weekday line', () => {
    const names = (text: string) => parseProgramText(text).days.map((d) => [d.day, d.label ?? null, d.lines.map((l) => `${l.name} ${l.sets ?? '-'}x${l.reps ?? '-'}`)])
    expect(names('Monday: Bench 3x8, Squat 3x5')).toEqual([[0, null, ['Bench 3x8', 'Squat 3x5']]])
    expect(names('Monday - Bench 3x8, Rows 3x10, Squat 3x5')).toEqual([[0, null, ['Bench 3x8', 'Rows 3x10', 'Squat 3x5']]])
    expect(names('Tuesday: Bench press, Incline DB press, Flyes')).toEqual([[1, null, ['Bench press -x-', 'Incline DB press -x-', 'Flyes -x-']]])
    expect(names('Monday: Bench 3x8; Squat 3x5')).toEqual([[0, null, ['Bench 3x8', 'Squat 3x5']]])
    expect(names('Monday (chest, triceps)')).toEqual([[0, 'chest, triceps', []]])
    expect(names('Monday: Face pull, 3, 12-15')).toEqual([[0, null, ['Face pull 3x12-15']]])
  })

  it('reads only the first week of a multi-week plan and says how many were left out', () => {
    const t = parseProgramText('Week 1\nMonday\nBench 3x8\nThursday\nSquat 3x5\nWeek 2\nMonday\nBench 3x9\nThursday\nSquat 3x6\n# Week 3\nMonday\nBench 3x10')
    expect(assignDays(t.days).days.map((d) => [d.day, d.lines.map((l) => l.reps)])).toEqual([
      [0, ['8']],
      [3, ['5']],
    ])
    expect(t.warnings).toEqual([{ kind: 'extra_weeks', count: 2 }])
  })

  it('starts a new week when a weekday comes round again', () => {
    const t = parseProgramText('Mon\nBench 3x8\nThu\nSquat 3x5\nMon\nBench 3x9\nThu\nSquat 3x6')
    expect(t.days.map((d) => [d.day, d.lines.length])).toEqual([
      [0, 1],
      [3, 1],
    ])
    expect(t.warnings).toEqual([{ kind: 'extra_weeks', count: 1 }])
    expect(parseProgramText('Mon\nBench 3x8\nMon\nRow 3x8').days.map((d) => [d.day, d.lines.length])).toEqual([
      [0, 1],
      [0, 1],
    ])
  })

  it('caps the input', () => {
    const t = parseProgramText(`Squat 3x5\n${'x'.repeat(IMPORT_MAX_CHARS)}`)
    expect(t.warnings[0]).toEqual({ kind: 'truncated' })
    const many = parseProgramText(Array.from({ length: 1000 }, () => 'Squat 3x5').join('\n'))
    expect(many.days[0].lines.length).toBe(400)
    expect(many.warnings).toEqual([{ kind: 'truncated' }])
  })
})

describe('CSV', () => {
  it('splits quoted fields', () => {
    expect(splitCsvRow('a,"b, c","say ""hi""",', ',')).toEqual(['a', 'b, c', 'say "hi"', ''])
  })

  it('reads columns in any order with semicolons', () => {
    const t = parseProgramText('Exercise;Day;Reps;Sets;Rest;RIR\n"Bench press, flat";Mon;8-10;3;90;2\nRow;Mon;10;3;2 min;\nSquat;Wed;5;5;3:00;1')
    expect(t.warnings).toEqual([])
    expect(t.days.map((d) => d.day)).toEqual([0, 2])
    expect(t.days[0].lines.map(({ raw: _r, ...l }) => l)).toEqual([
      { name: 'Bench press, flat', sets: 3, reps: '8-10', restSec: 90, rir: 2 },
      { name: 'Row', sets: 3, reps: '10', restSec: 120 },
    ])
    expect(t.days[1].lines[0]).toMatchObject({ name: 'Squat', sets: 5, restSec: 180, rir: 1 })
  })

  it('reads tabs and session labels, Ukrainian headers too', () => {
    const t = parseProgramText('День\tВправа\tПідходи\tПовторення\nPush\tЖим\t4\t6-8\nPush\tВіджимання\t3\t12\nPull\tТяга\t4\t8')
    expect(t.days.map((d) => [d.day, d.label, d.lines.length])).toEqual([
      [null, 'Push', 2],
      [null, 'Pull', 1],
    ])
  })

  it('needs a name column to count as CSV', () => {
    const t = parseProgramText('Squat, 3, 5\nBench, 3, 5')
    expect(t.days[0].lines.map((l) => [l.name, l.sets, l.reps])).toEqual([
      ['Squat', 3, '5'],
      ['Bench', 3, '5'],
    ])
  })
})

const day = (d: Partial<ParsedDay>): ParsedDay => ({ day: null, rest: false, lines: [{ raw: 'x', name: 'x' }], ...d })

describe('assignDays', () => {
  it('spreads sessions without weekdays like templates do', () => {
    expect(assignDays([day({})]).days.map((d) => d.day)).toEqual([0])
    expect(assignDays([day({}), day({})]).days.map((d) => d.day)).toEqual([0, 3])
    expect(assignDays([day({}), day({}), day({})]).days.map((d) => d.day)).toEqual([0, 2, 4])
    expect(assignDays(Array.from({ length: 4 }, () => day({}))).days.map((d) => d.day)).toEqual([0, 1, 3, 4])
  })

  it('goes in order when the text lists rest days', () => {
    const r = assignDays([day({}), day({ rest: true, lines: [] }), day({})])
    expect(r.days.map((d) => [d.day, d.rest])).toEqual([
      [0, false],
      [1, true],
      [2, false],
    ])
  })

  it('keeps weekdays, merges repeats and fills free days in order', () => {
    const r = assignDays([day({ day: 2 }), day({}), day({ day: 2, label: 'Legs' })])
    expect(r.days.map((d) => [d.day, d.lines.length, d.label ?? null])).toEqual([
      [0, 1, null],
      [2, 2, 'Legs'],
    ])
  })

  it('drops sessions past seven with a warning', () => {
    const r = assignDays(Array.from({ length: 9 }, () => day({})))
    expect(r.days).toHaveLength(7)
    expect(r.warnings).toEqual([{ kind: 'extra_days', count: 2 }])
  })
})

describe('buildImportedProgram', () => {
  it('builds a valid program with rest, RIR, labels and shared custom exercises', () => {
    const custom = { custom: { name: 'Sled push', equipment: [], laterality: 'bilateral' as const, groups: { quads: 'primary' as const } } }
    const p = buildImportedProgram(
      'p1',
      'Imported program',
      [
        { day: 0, label: 'Push', rest: false, entries: [{ ref: 101, sets: 4, reps: '6-8', restSec: 120, rir: 2 }, { ref: custom }] },
        { day: 1, rest: true, entries: [] },
        { day: 3, rest: false, entries: [{ ref: custom, sets: 2 }] },
      ],
      sequentialIds('e'),
    )
    expect(Program.safeParse(p).success).toBe(true)
    expect(p.days.map((d) => d.kind)).toEqual(['train', 'rest', 'rest', 'train', 'rest', 'rest', 'rest'])
    expect(p.days[0].label).toBe('Push')
    expect(p.days[0].entries[0]).toMatchObject({ exerciseId: 101, sets: 4, reps: '6-8', restSec: 120, rir: 2 })
    expect(p.days[0].entries[1]).toMatchObject({ exerciseId: 'c1', sets: 3 })
    expect(p.days[3].entries[0]).toMatchObject({ exerciseId: 'c1', sets: 2 })
    expect(p.custom).toHaveLength(1)
  })

  it('copies a matched custom exercise from another program instead of keeping its id', () => {
    const source: CustomExercise[] = [
      { id: 'c1', name: 'Warm-up row', equipment: [], laterality: 'bilateral' as const, groups: {} },
      { id: 'c2', name: 'Sled push', equipment: ['sled'], laterality: 'bilateral' as const, groups: { quads: 'primary' as const } },
    ]
    expect(importRefFor(101, source)).toBe(101)
    expect(importRefFor('c9', source)).toBeNull()
    const ref = importRefFor('c2', source)!
    expect(ref).toEqual({ custom: { name: 'Sled push', equipment: ['sled'], laterality: 'bilateral', groups: { quads: 'primary' } } })
    const p = buildImportedProgram('p1', 'Imported program', [{ day: 0, rest: false, entries: [{ ref, sets: 4 }] }], sequentialIds('e'))
    expect(p.custom).toEqual([{ id: 'c1', name: 'Sled push', equipment: ['sled'], laterality: 'bilateral', groups: { quads: 'primary' } }])
    expect(p.days[0].entries[0]).toMatchObject({ exerciseId: 'c1', sets: 4 })
  })

  it('links supersets only where a pair is allowed', () => {
    const p = buildImportedProgram(
      'p1',
      'Imported program',
      [{ day: 0, rest: false, entries: [{ ref: 101, withPrev: true }, { ref: 102 }, { ref: 103, withPrev: true }, { ref: 104, withPrev: true }] }],
      sequentialIds('e'),
    )
    expect(Program.safeParse(p).success).toBe(true)
    expect(p.days[0].entries.map((e) => !!e.withPrev)).toEqual([false, false, true, false])
  })
})

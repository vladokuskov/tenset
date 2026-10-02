import { describe, expect, it } from 'vitest'
import { sequentialIds } from './ids.ts'
import {
  IMPORT_MAX_CHARS,
  assignDays,
  buildImportedProgram,
  parseDuration,
  parseHeader,
  parseLine,
  parseProgramText,
  splitCsvRow,
  type ParsedDay,
} from './importText.ts'
import { Program } from './schema.ts'

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
  ])('%s', (line, want) => {
    expect(fields(line)).toEqual(want)
  })

  it('clamps sets, reps, rest and RIR', () => {
    expect(fields('Curl 30x10')?.sets).toBe(20)
    expect(fields('Curl 0x10')?.sets).toBe(1)
    expect(fields('Curl 3x10 rest 20 min')?.restSec).toBe(600)
    expect(fields('Curl 3x10 rest 50s')?.restSec).toBe(45)
    expect(fields('Curl 3x10 RIR 7')?.rir).toBe(5)
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
    ['Push:', { day: null, label: 'Push', rest: false }],
    ['Upper A:', { day: null, label: 'Upper A', rest: false }],
    ['## Legs', { day: null, label: 'Legs', rest: false }],
    ['**Arms**', { day: null, label: 'Arms', rest: false }],
    ['Rest', { day: null, rest: true }],
    ['Відпочинок', { day: null, rest: true }],
    ['Sunday: rest', { day: 6, rest: true }],
    ['Нд - відпочинок', { day: 6, rest: true }],
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
    const t = parseProgramText('Week 1\n---\nSquat 3x5\n\n***')
    expect(t.warnings).toEqual([])
    expect(t.days[0].lines).toHaveLength(1)
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
})

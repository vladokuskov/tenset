import { describe, expect, it } from 'vitest'
import { presetEquipment } from './equipment.ts'
import { sequentialIds } from './ids.ts'
import * as ops from './program.ts'
import { Program } from './schema.ts'
import { BENCH, CATALOG, INCLINE_DB, LEG_CURL, LUNGE, OLD_INCLINE, PULL_UP, PUSH_UP, ROW, SQUAT, TEMPLATE, catalogOf } from './test-fixtures.ts'

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

const base = () => {
  const ids = sequentialIds('e')
  let p = ops.blankProgram('p1', 'Test')
  p = ops.addEntries(p, 0, [BENCH.id, ROW.id], ids)
  p = ops.addEntries(p, 2, [SQUAT.id], ids, 4, '6-8')
  return deepFreeze(p)
}

describe('program ops', () => {
  it('creates a valid blank program', () => {
    const p = ops.blankProgram('p1', '  ', [0, 2, 4])
    expect(Program.parse(p)).toEqual(p)
    expect(p.name).toBe('My program')
    expect(p.days.map((d) => d.kind)).toEqual(['train', 'rest', 'train', 'rest', 'train', 'rest', 'rest'])
    expect(ops.blankProgram('p2').days.every((d) => d.kind === 'train' && d.entries.length === 0)).toBe(true)
  })

  it('adds entries with factory ids, default sets and optional reps', () => {
    const p = base()
    expect(p.days[0].entries).toEqual([
      { id: 'e1', exerciseId: BENCH.id, sets: 3 },
      { id: 'e2', exerciseId: ROW.id, sets: 3 },
    ])
    expect(p.days[2].entries).toEqual([{ id: 'e3', exerciseId: SQUAT.id, sets: 4, reps: '6-8' }])
    expect(Program.safeParse(p).success).toBe(true)
  })

  it('turns a rest day into a training day when adding to it', () => {
    const p = ops.addEntries(ops.setRest(base(), 1), 1, [PUSH_UP.id], () => 'x')
    expect(p.days[1].kind).toBe('train')
  })

  it('clamps sets to 1..20', () => {
    const p = base()
    expect(ops.setSets(p, 'e1', 50).days[0].entries[0].sets).toBe(20)
    expect(ops.setSets(p, 'e1', 0).days[0].entries[0].sets).toBe(1)
    expect(ops.setSets(p, 'e1', 4.6).days[0].entries[0].sets).toBe(5)
    expect(ops.addEntries(p, 3, [BENCH.id], () => 'x', 99).days[3].entries[0].sets).toBe(20)
  })

  it('sets and clears reps', () => {
    const p = ops.setReps(base(), 'e1', ' 10-15 ')
    expect(p.days[0].entries[0].reps).toBe('10-15')
    const cleared = ops.setReps(p, 'e1', '')
    expect('reps' in cleared.days[0].entries[0]).toBe(false)
  })

  it('removes entries', () => {
    const p = ops.removeEntry(base(), 'e1')
    expect(p.days[0].entries.map((e) => e.id)).toEqual(['e2'])
    expect(ops.removeEntry(p, 'missing')).toBe(p)
  })

  it('moves entries between days, to an index, onto rest days', () => {
    const rest = ops.setRest(base(), 5)
    const p = ops.moveEntry(rest, 'e1', 5)
    expect(p.days[0].entries.map((e) => e.id)).toEqual(['e2'])
    expect(p.days[5]).toMatchObject({ kind: 'train', entries: [{ id: 'e1' }] })
    const q = ops.moveEntry(base(), 'e3', 0, 1)
    expect(q.days[0].entries.map((e) => e.id)).toEqual(['e1', 'e3', 'e2'])
    expect(q.days[2].entries).toEqual([])
  })

  it('copies an entry with a new id', () => {
    const p = ops.copyEntry(base(), 'e3', 4, () => 'copy')
    expect(p.days[2].entries).toHaveLength(1)
    expect(p.days[4].entries).toEqual([{ id: 'copy', exerciseId: SQUAT.id, sets: 4, reps: '6-8' }])
  })

  it('reorders within a day', () => {
    const p = ops.reorder(base(), 0, 0, 1)
    expect(p.days[0].entries.map((e) => e.id)).toEqual(['e2', 'e1'])
    expect(ops.reorder(base(), 0, 5, 0).days[0].entries.map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('swaps the exercise of an entry', () => {
    const p = ops.swapEntry(base(), 'e1', INCLINE_DB.id)
    expect(p.days[0].entries[0]).toEqual({ id: 'e1', exerciseId: INCLINE_DB.id, sets: 3 })
  })

  it('duplicates a day over another with fresh ids', () => {
    const labelled = ops.setLabel(base(), 0, 'Push')
    const p = ops.duplicateDay(labelled, 0, 3, sequentialIds('d'))
    expect(p.days[3]).toEqual({
      kind: 'train',
      label: 'Push',
      entries: [
        { id: 'd1', exerciseId: BENCH.id, sets: 3 },
        { id: 'd2', exerciseId: ROW.id, sets: 3 },
      ],
    })
    expect(ops.duplicateDay(labelled, 0, 0, () => 'x')).toBe(labelled)
  })

  it('clears a day but keeps its kind and label', () => {
    const p = ops.clearDay(ops.setLabel(base(), 0, 'Push'), 0)
    expect(p.days[0]).toEqual({ kind: 'train', label: 'Push', entries: [] })
  })

  it('keeps entries when toggling rest and train', () => {
    const rest = ops.setRest(base(), 0)
    expect(rest.days[0].kind).toBe('rest')
    expect(rest.days[0].entries).toHaveLength(2)
    expect(ops.setTrain(rest, 0).days[0].kind).toBe('train')
  })

  it('trims labels and notes, drops empty ones, caps length', () => {
    const p = ops.setNote(ops.setLabel(base(), 1, '  Legs  '), 1, 'x'.repeat(100))
    expect(p.days[1].label).toBe('Legs')
    expect(p.days[1].note).toHaveLength(80)
    const cleared = ops.setNote(ops.setLabel(p, 1, ''), 1, undefined)
    expect(cleared.days[1]).toEqual({ kind: 'train', entries: [] })
    expect(ops.setLabel(base(), 1, 'y'.repeat(40)).days[1].label).toHaveLength(24)
  })

  it('renames, ignoring blank names', () => {
    const p = base()
    expect(ops.rename(p, ' Push Pull ').name).toBe('Push Pull')
    expect(ops.rename(p, '   ')).toBe(p)
  })

  it('manages custom exercises and their entries', () => {
    const input = { name: 'Band row', equipment: [], laterality: 'bilateral' as const, groups: { upper_back: 'primary' as const } }
    const a = ops.addCustomExercise(base(), input)!
    expect(a.id).toBe('c1')
    const b = ops.addCustomExercise(a.program, { ...input, name: 'Band pull-apart' })!
    expect(b.id).toBe('c2')
    let p = ops.addEntries(b.program, 1, ['c1', 'c2'], sequentialIds('x'))
    p = ops.updateCustomExercise(p, 'c1', { name: '  ', groups: { lats: 'primary' } })
    expect(p.custom[0]).toMatchObject({ id: 'c1', name: 'Band row', groups: { lats: 'primary' } })
    p = ops.removeCustomExercise(p, 'c1')
    expect(p.custom.map((c) => c.id)).toEqual(['c2'])
    expect(p.days[1].entries.map((e) => e.exerciseId)).toEqual(['c2'])
    expect(Program.safeParse(p).success).toBe(true)
    // a freed id is reused
    expect(ops.addCustomExercise(p, input)!.id).toBe('c1')
  })

  it('caps custom exercises at 30', () => {
    let p = ops.blankProgram('p')
    const input = { name: 'X', equipment: [], laterality: 'bilateral' as const, groups: { chest: 'primary' as const } }
    for (let i = 0; i < 30; i++) p = ops.addCustomExercise(p, input)!.program
    expect(p.custom).toHaveLength(30)
    expect(ops.addCustomExercise(p, input)).toBeNull()
  })

  it('never mutates its input', () => {
    const p = base()
    expect(() => {
      ops.removeEntry(p, 'e1')
      ops.moveEntry(p, 'e1', 3)
      ops.reorder(p, 0, 0, 1)
      ops.duplicateDay(p, 0, 1, () => 'x')
      ops.setLabel(p, 0, 'A')
      ops.setReps(p, 'e3', undefined)
    }).not.toThrow()
  })
})

describe('applyTemplate', () => {
  const opts = () => ({ id: 'p1', makeId: sequentialIds('t') })

  it('fills slots with the first option the equipment allows', () => {
    const { program, notes } = ops.applyTemplate(TEMPLATE, [0, 3], ['*'], CATALOG, opts())
    expect(notes).toEqual([])
    expect(Program.safeParse(program).success).toBe(true)
    expect(program.templateId).toBe(TEMPLATE.id)
    expect(program.name).toBe(TEMPLATE.name)
    expect(program.days.map((d) => d.kind)).toEqual(['train', 'rest', 'rest', 'train', 'rest', 'rest', 'rest'])
    expect(program.days[0]).toEqual({
      kind: 'train',
      label: 'Upper',
      entries: [
        { id: 't1', exerciseId: BENCH.id, sets: 3, reps: '6-8' },
        { id: 't2', exerciseId: ROW.id, sets: 3 },
        { id: 't3', exerciseId: PULL_UP.id, sets: 2 },
      ],
    })
    expect(program.days[3].entries.map((e) => e.exerciseId)).toEqual([SQUAT.id, LEG_CURL.id])
  })

  it('falls back down the ranked options and drops unfillable slots with a note', () => {
    const { program, notes } = ops.applyTemplate(TEMPLATE, [0, 3], presetEquipment('dumbbells_bench'), CATALOG, opts())
    expect(program.days[0].entries.map((e) => e.exerciseId)).toEqual([INCLINE_DB.id])
    expect(program.days[3].entries.map((e) => e.exerciseId)).toEqual([LUNGE.id])
    expect(notes.map((n) => n.kind === 'dropped_slot' && [n.day, n.group, n.pattern])).toEqual([
      [0, 'upper_back', 'horizontal_pull'],
      [0, 'lats', 'vertical_pull'],
      [3, 'hamstrings', 'knee_flexion'],
    ])
    expect(notes[0]).toEqual({ kind: 'dropped_slot', day: 0, session: 'Upper', slot: 1, pattern: 'horizontal_pull', group: 'upper_back' })
  })

  it('reaches the bodyweight option', () => {
    const { program } = ops.applyTemplate(TEMPLATE, [0, 3], presetEquipment('bodyweight'), CATALOG, opts())
    expect(program.days[0].entries.map((e) => e.exerciseId)).toEqual([PUSH_UP.id, PULL_UP.id])
  })

  it('uses default days when none are given and notes a day count mismatch', () => {
    expect(ops.applyTemplate(TEMPLATE, undefined, ['*'], CATALOG, opts()).program.days[3].label).toBe('Lower')
    const { program, notes } = ops.applyTemplate(TEMPLATE, [1, 3, 5], ['*'], CATALOG, opts())
    expect(program.days.map((d) => d.label ?? null)).toEqual([null, 'Upper', null, 'Lower', null, 'Upper', null])
    expect(notes).toEqual([
      { kind: 'day_count', expected: 2, got: 3 },
    ])
  })

  it('follows replacedBy for retired options', () => {
    const template = { ...TEMPLATE, sessions: [{ label: 'A', slots: [{ pattern: 'incline_push' as const, group: 'chest', sets: 3, options: [OLD_INCLINE.id] }] }] }
    const { program } = ops.applyTemplate(template, [0, 3], ['*'], CATALOG, opts())
    expect(program.days[0].entries[0].exerciseId).toBe(INCLINE_DB.id)
    const noTarget = catalogOf(OLD_INCLINE)
    const dropped = ops.applyTemplate(template, [0], ['*'], noTarget, opts())
    expect(dropped.notes.some((n) => n.kind === 'dropped_slot')).toBe(true)
  })
})

describe('rest, RIR and supersets', () => {
  // Day 0: a, b, c, d with b+c paired
  const paired = () => {
    const ids = sequentialIds('e')
    let p = ops.blankProgram('p1', 'Test')
    p = ops.addEntries(p, 0, [BENCH.id, ROW.id, PUSH_UP.id, PULL_UP.id], ids)
    p = ops.linkWithPrev(p, 'e3', true)
    return deepFreeze(p)
  }
  const flags = (p: Program, day = 0) => p.days[day].entries.map((e) => `${e.id}${e.withPrev ? '+' : ''}`)

  it('quantizes rest and clamps RIR, and clears them with undefined', () => {
    let p = ops.setRestSec(base(), 'e1', 97)
    expect(p.days[0].entries[0].restSec).toBe(90)
    expect(ops.setRestSec(p, 'e1', 9999).days[0].entries[0].restSec).toBe(600)
    expect(ops.setRestSec(p, 'e1', undefined).days[0].entries[0]).not.toHaveProperty('restSec')
    p = ops.setRir(p, 'e1', 9)
    expect(p.days[0].entries[0].rir).toBe(5)
    expect(ops.setRir(p, 'e1', 0).days[0].entries[0].rir).toBe(0)
    expect(ops.setRir(p, 'e1', undefined).days[0].entries[0]).not.toHaveProperty('rir')
    expect(Program.safeParse(p).success).toBe(true)
  })

  it('trims entry notes, caps them at 60 and clears blank ones', () => {
    let p = ops.setEntryNote(base(), 'e1', '  seat 4  ')
    expect(p.days[0].entries[0].note).toBe('seat 4')
    expect(ops.setEntryNote(p, 'e1', 'x'.repeat(90)).days[0].entries[0].note).toHaveLength(ops.ENTRY_NOTE_MAX)
    expect(ops.setEntryNote(p, 'e1', '   ').days[0].entries[0]).not.toHaveProperty('note')
    expect(ops.setEntryNote(p, 'e1', undefined).days[0].entries[0]).not.toHaveProperty('note')
    expect(ops.setEntryNote(p, 'e1', ' seat 4')).toBe(p)
    expect(ops.setEntryNote(base(), 'e1', '')).toEqual(base())
    expect(ops.copyEntry(p, 'e1', 1, sequentialIds('x')).days[1].entries[0].note).toBe('seat 4')
    expect(Program.safeParse(p).success).toBe(true)
    p = ops.setEntryNote(p, 'e1', 'pause at bottom')
    expect(Program.safeParse({ ...p, days: p.days.map((d) => ({ ...d, entries: d.entries.map((e) => ({ ...e, note: 'x'.repeat(61) })) })) }).success).toBe(false)
  })

  it('links pairs only', () => {
    const p = paired()
    expect(flags(p)).toEqual(['e1', 'e2', 'e3+', 'e4'])
    expect(ops.linkWithPrev(p, 'e1', true)).toBe(p)
    expect(ops.linkWithPrev(p, 'e4', true)).toBe(p)
    expect(ops.linkWithPrev(p, 'e2', true)).toBe(p)
    expect(flags(ops.linkWithPrev(p, 'e3', false))).toEqual(['e1', 'e2', 'e3', 'e4'])
  })

  it('removing either half dissolves the pair', () => {
    expect(flags(ops.removeEntry(paired(), 'e2'))).toEqual(['e1', 'e3', 'e4'])
    expect(flags(ops.removeEntry(paired(), 'e3'))).toEqual(['e1', 'e2', 'e4'])
    expect(flags(ops.removeEntry(paired(), 'e1'))).toEqual(['e2', 'e3+', 'e4'])
  })

  it('moving or reordering an entry takes it out of its pair and never lands inside one', () => {
    expect(flags(ops.moveEntry(paired(), 'e2', 1))).toEqual(['e1', 'e3', 'e4'])
    expect(flags(ops.moveEntry(paired(), 'e2', 1), 1)).toEqual(['e2'])
    expect(flags(ops.reorder(paired(), 0, 0, 2))).toEqual(['e2', 'e3+', 'e1', 'e4'])
    expect(flags(ops.reorder(paired(), 0, 3, 0))).toEqual(['e4', 'e1', 'e2', 'e3+'])
    expect(flags(ops.reorder(paired(), 0, 2, 0))).toEqual(['e3', 'e1', 'e2', 'e4'])
    expect(flags(ops.reorder(paired(), 0, 3, 2))).toEqual(['e1', 'e2', 'e4', 'e3'])
  })

  it('copies leave the pair, duplicated days keep it', () => {
    const ids = sequentialIds('x')
    const copied = ops.copyEntry(paired(), 'e3', 0, ids)
    expect(flags(copied)).toEqual(['e1', 'e2', 'e3+', 'e4', 'x1'])
    expect(flags(ops.duplicateDay(paired(), 0, 1, sequentialIds('y')), 1)).toEqual(['y1', 'y2', 'y3+', 'y4'])
  })

  it('removing a custom exercise dissolves its pair', () => {
    const ids = sequentialIds('e')
    const added = ops.addCustomExercise(ops.blankProgram('p1'), { name: 'Band', equipment: [], laterality: 'bilateral', groups: { rear_delt: 'primary' } })!
    let p = ops.addEntries(added.program, 0, [BENCH.id, added.id, ROW.id], ids)
    p = ops.linkWithPrev(p, 'e2', true)
    expect(ops.linkWithPrev(p, 'e3', true)).toBe(p)
    expect(flags(p)).toEqual(['e1', 'e2+', 'e3'])
    expect(flags(ops.removeCustomExercise(p, added.id))).toEqual(['e1', 'e3'])
  })

  it('normalizes imported flags', () => {
    const p = paired()
    const broken = { ...p, days: p.days.map((d, i) => (i === 0 ? { ...d, entries: d.entries.map((e) => ({ ...e, withPrev: true as const })) } : d)) }
    expect(flags(ops.normalizeProgramSupersets(broken))).toEqual(['e1', 'e2+', 'e3', 'e4+'])
    expect(ops.normalizeProgramSupersets(p)).toBe(p)
  })
})

import { describe, expect, it } from 'vitest'
import { CODEC_EQUIPMENT_V1, CODEC_GROUPS_V1, decodeProgram, encodeProgram } from './codec.ts'
import { equipmentIds } from './equipment.ts'
import { sequentialIds } from './ids.ts'
import type { Program } from './schema.ts'
import { groupIds } from './taxonomy.ts'

const withIds = (p: Program): Program => {
  const id = sequentialIds('e')
  return { ...p, days: p.days.map((d) => ({ ...d, entries: d.entries.map((e) => ({ ...e, id: id() })) })) }
}

const empty = (kind: 'train' | 'rest' = 'rest') => ({ kind, entries: [] })

// Frozen fixtures: the strings below must keep decoding to these programs forever.
const GOLDEN_SIMPLE: Program = {
  id: 'shared',
  name: 'Upper/Lower',
  custom: [],
  days: [
    {
      kind: 'train',
      label: 'Upper',
      entries: [
        { id: 'e1', exerciseId: 101, sets: 3, reps: '6-8' },
        { id: 'e2', exerciseId: 305, sets: 3 },
        { id: 'e3', exerciseId: 203, sets: 4, reps: '10-15' },
      ],
    },
    empty(),
    {
      kind: 'train',
      label: 'Lower',
      entries: [
        { id: 'e4', exerciseId: 401, sets: 4, reps: '3-5' },
        { id: 'e5', exerciseId: 503, sets: 3 },
      ],
    },
    empty(),
    empty('train'),
    empty(),
    empty(),
  ],
}

const GOLDEN_CUSTOM: Program = {
  id: 'shared',
  name: 'Garage gym ü',
  custom: [
    { id: 'c1', name: 'Band pull-apart', equipment: [], laterality: 'bilateral', groups: { rear_delt: 'primary', upper_back: 'secondary' } },
    { id: 'c3', name: 'Sandbag carry', equipment: ['plate', 'step'], laterality: 'alternating', groups: { forearms: 'primary', abs: 'secondary', tibialis: 'secondary' } },
  ],
  days: [
    { kind: 'train', note: 'Superset the last two', entries: [{ id: 'e1', exerciseId: 65535, sets: 20, reps: 'AMRAP' }, { id: 'e2', exerciseId: 'c1', sets: 1 }] },
    { kind: 'rest', label: 'Walk', entries: [{ id: 'e3', exerciseId: 'c3', sets: 2, reps: '20-30' }] },
    empty(),
    empty(),
    empty(),
    empty(),
    { kind: 'train', entries: [{ id: 'e4', exerciseId: 1, sets: 5 }] },
  ],
}

const GOLDEN_SIMPLE_V1 = 'AQtVcHBlci9Mb3dlchUFBVVwcGVyBUxvd2VyAAADEgBlARABMRoAywMAAhoBkQAQAfcAAAAA'
const GOLDEN_CUSTOM_V1 =
  'AQ1HYXJhZ2UgZ3ltIMO8QQIEV2FsawEVU3VwZXJzZXQgdGhlIGxhc3QgdHdvAgEPQmFuZCBwdWxsLWFwYXJ0AAACDAUDDVNhbmRiYWcgY2FycnkCAhgZAxIVLQKc__8FQU1SQVABAQELAwUAAAAAASAAAQ'

describe('share codec', () => {
  it('round-trips a program with custom exercises, labels, notes and reps', () => {
    const encoded = encodeProgram(GOLDEN_CUSTOM)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeProgram(encoded)).toEqual({ ok: true, program: GOLDEN_CUSTOM })
  })

  it('round-trips a plain template program', () => {
    expect(decodeProgram(encodeProgram(GOLDEN_SIMPLE))).toEqual({ ok: true, program: GOLDEN_SIMPLE })
  })

  it('round-trips a full week', () => {
    const p = withIds({
      id: 'x',
      name: 'PPL',
      custom: [],
      days: Array.from({ length: 7 }, (_, d) => ({
        kind: d === 6 ? 'rest' : 'train',
        label: `Day ${d + 1}`,
        entries: Array.from({ length: 6 }, (_, k) => ({ id: '', exerciseId: 100 + d * 10 + k, sets: 1 + ((d + k) % 20) })),
      })),
    })
    const encoded = encodeProgram(p)
    expect(encoded.length).toBeLessThan(400)
    expect(decodeProgram(encoded, { id: 'x' })).toEqual({ ok: true, program: p })
  })

  it('uses the given id and id factory', () => {
    const r = decodeProgram(encodeProgram(GOLDEN_SIMPLE), { id: 'new', makeId: sequentialIds('z') })
    expect(r.ok && r.program.id).toBe('new')
    expect(r.ok && r.program.days[0].entries.map((e) => e.id)).toEqual(['z1', 'z2', 'z3'])
  })

  it('maps retired ids through replacement chains', () => {
    const p = withIds({ ...GOLDEN_SIMPLE, days: [{ kind: 'train', entries: [{ id: '', exerciseId: 7, sets: 3 }, { id: '', exerciseId: 101, sets: 3 }] }, ...GOLDEN_SIMPLE.days.slice(1)] })
    const replacedBy = new Map([
      [7, 8],
      [8, 9],
      [50, 50],
    ])
    const r = decodeProgram(encodeProgram(p), { replacedBy })
    expect(r.ok && r.program.days[0].entries.map((e) => e.exerciseId)).toEqual([9, 101])
    const loop = decodeProgram(encodeProgram({ ...p, days: [{ kind: 'train', entries: [{ id: 'e1', exerciseId: 50, sets: 1 }] }, ...p.days.slice(1)] }), { replacedBy })
    expect(loop.ok && loop.program.days[0].entries[0].exerciseId).toBe(50)
  })

  it('accepts a leading #', () => {
    expect(decodeProgram(`#${encodeProgram(GOLDEN_SIMPLE)}`).ok).toBe(true)
  })

  it('rejects bad input without throwing', () => {
    const good = encodeProgram(GOLDEN_CUSTOM)
    expect(decodeProgram('')).toEqual({ ok: false, error: 'empty' })
    expect(decodeProgram('not base64!')).toEqual({ ok: false, error: 'malformed' })
    expect(decodeProgram('A')).toEqual({ ok: false, error: 'malformed' })
    expect(decodeProgram(good.slice(0, -6))).toEqual({ ok: false, error: 'malformed' })
    expect(decodeProgram(`${good}AAAA`)).toEqual({ ok: false, error: 'malformed' })
    expect(decodeProgram('Ag')).toEqual({ ok: false, error: 'unsupported_version' })
    expect(decodeProgram('x'.repeat(20000))).toEqual({ ok: false, error: 'malformed' })
  })

  it('rejects programs that fail validation', () => {
    const orphan = { ...GOLDEN_SIMPLE, days: [{ kind: 'train' as const, entries: [{ id: 'e1', exerciseId: 'c5', sets: 3 }] }, ...GOLDEN_SIMPLE.days.slice(1)] }
    expect(decodeProgram(encodeProgram(orphan))).toEqual({ ok: false, error: 'invalid' })
    expect(decodeProgram(encodeProgram({ ...GOLDEN_SIMPLE, name: 'x'.repeat(41) }))).toEqual({ ok: false, error: 'invalid' })
    expect(decodeProgram(encodeProgram({ ...GOLDEN_SIMPLE, name: '' }))).toEqual({ ok: false, error: 'invalid' })
  })

  it('wire tables cover every group and equipment id (append new ids, never reorder)', () => {
    for (const g of groupIds) expect(CODEC_GROUPS_V1, g).toContain(g)
    for (const e of equipmentIds) expect(CODEC_EQUIPMENT_V1, e).toContain(e)
  })

  it('decodes frozen v1 strings forever', () => {
    expect(decodeProgram(GOLDEN_SIMPLE_V1)).toEqual({ ok: true, program: GOLDEN_SIMPLE })
    expect(decodeProgram(GOLDEN_CUSTOM_V1)).toEqual({ ok: true, program: GOLDEN_CUSTOM })
  })

  it('v1 encoder output is stable', () => {
    expect(encodeProgram(GOLDEN_SIMPLE)).toBe(GOLDEN_SIMPLE_V1)
    expect(encodeProgram(GOLDEN_CUSTOM)).toBe(GOLDEN_CUSTOM_V1)
  })
})

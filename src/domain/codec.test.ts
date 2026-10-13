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

// Frozen v2 fixture: rest, RIR (including 0), a superset, a custom ref and text reps.
const GOLDEN_EXT: Program = {
  id: 'shared',
  name: 'Supersets',
  custom: [{ id: 'c2', name: 'Band face pull', equipment: [], laterality: 'bilateral', groups: { rear_delt: 'primary' } }],
  days: [
    {
      kind: 'train',
      label: 'Upper',
      entries: [
        { id: 'e1', exerciseId: 101, sets: 4, reps: '6-8', restSec: 180, rir: 2 },
        { id: 'e2', exerciseId: 305, sets: 3, reps: '8-12', rir: 0 },
        { id: 'e3', exerciseId: 'c2', sets: 3, reps: 'to 15', restSec: 60, withPrev: true },
        { id: 'e4', exerciseId: 203, sets: 2 },
      ],
    },
    empty(),
    empty(),
    empty(),
    empty(),
    empty(),
    empty(),
  ],
}
const GOLDEN_EXT_V2 = 'AglTdXBlcnNldHMBAQVVcHBlcgABAg5CYW5kIGZhY2UgcHVsbAAAAQwEGgBlARMMEgExAgIVAgV0byAxNQUECADLAAAAAAAAAA'

// Frozen v3 fixture: v2 plus per-entry notes, one on an entry that has no other extension field.
const GOLDEN_NOTES: Program = {
  ...GOLDEN_EXT,
  name: 'Notes',
  days: GOLDEN_EXT.days.map((d, i) =>
    i === 0
      ? {
          ...d,
          entries: d.entries.map((e, k) => (k === 0 ? { ...e, note: 'Seat 4, pause at bottom' } : k === 3 ? { ...e, note: 'Ремінці' } : e)),
        }
      : d,
  ),
}
const GOLDEN_NOTES_V3 = 'AwVOb3RlcwEBBVVwcGVyAAECDkJhbmQgZmFjZSBwdWxsAAABDAQaAGUBUwwXU2VhdCA0LCBwYXVzZSBhdCBib3R0b20SATECAhUCBXRvIDE1BQQIAMtADtCg0LXQvNGW0L3RhtGWAAAAAAAA'

const v2 = (b64: string) => {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const toB64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

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
    expect(decodeProgram('BA')).toEqual({ ok: false, error: 'unsupported_version' })
    expect(decodeProgram('AA')).toEqual({ ok: false, error: 'unsupported_version' })
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

  it('decodes the frozen v2 string forever and encodes it stably', () => {
    expect(decodeProgram(GOLDEN_EXT_V2)).toEqual({ ok: true, program: GOLDEN_EXT })
    expect(encodeProgram(GOLDEN_EXT)).toBe(GOLDEN_EXT_V2)
  })

  it('keeps writing v1 when no entry uses a v2 field', () => {
    expect(v2(encodeProgram(GOLDEN_SIMPLE))[0]).toBe(1)
    expect(v2(GOLDEN_EXT_V2)[0]).toBe(2)
  })

  it('decodes v2 without adding absent fields', () => {
    const res = decodeProgram(GOLDEN_EXT_V2)
    expect(res.ok && res.program.days[0].entries[3]).toStrictEqual({ id: 'e4', exerciseId: 203, sets: 2 })
  })

  it('repairs superset flags that break the pairs-only rule', () => {
    const p = withIds({
      ...GOLDEN_EXT,
      days: GOLDEN_EXT.days.map((d, i) =>
        i === 0 ? { ...d, entries: d.entries.map((e, k) => (k === 0 || k === 3 ? { ...e, withPrev: true as const } : e)) } : d,
      ),
    })
    const res = decodeProgram(encodeProgram(p))
    expect(res.ok && res.program.days[0].entries.map((e) => !!e.withPrev)).toEqual([false, false, true, false])
  })

  it('rejects bad v2 extension bytes', () => {
    // Day 1 holds one entry: header (3 sets, no reps), u16 ref, then the extension byte under test.
    const one = (ext: number[]) => {
      const head = v2(encodeProgram(withIds({ ...GOLDEN_SIMPLE, days: GOLDEN_SIMPLE.days.map(() => empty()) })))
      const bytes = [2, ...head.slice(1, -7), 1, 2 << 3, 0, 101, ...ext, 0, 0, 0, 0, 0, 0]
      return decodeProgram(toB64(Uint8Array.from(bytes)))
    }
    expect(one([0]).ok).toBe(true)
    expect(one([1, 40])).toMatchObject({ ok: true })
    expect(one([1, 41])).toEqual({ ok: false, error: 'malformed' })
    expect(one([0x40])).toEqual({ ok: false, error: 'malformed' })
    expect(one([2 | (6 << 3)])).toEqual({ ok: false, error: 'malformed' })
    expect(one([3 << 3])).toEqual({ ok: false, error: 'malformed' })
    expect(one([1])).toEqual({ ok: false, error: 'malformed' })
  })

  it('decodes the frozen v3 string forever and encodes it stably', () => {
    expect(decodeProgram(GOLDEN_NOTES_V3)).toEqual({ ok: true, program: GOLDEN_NOTES })
    expect(encodeProgram(GOLDEN_NOTES)).toBe(GOLDEN_NOTES_V3)
    expect(v2(GOLDEN_NOTES_V3)[0]).toBe(3)
  })

  it('writes v3 only when an entry has a note, so older links stay readable by older apps', () => {
    expect(v2(encodeProgram(GOLDEN_EXT))[0]).toBe(2)
    expect(v2(encodeProgram(GOLDEN_SIMPLE))[0]).toBe(1)
    const noteOnly = withIds({ ...GOLDEN_SIMPLE, days: GOLDEN_SIMPLE.days.map((d, i) => (i === 0 ? { ...d, entries: [{ id: '', exerciseId: 101, sets: 3, note: 'use straps' }] } : d)) })
    const encoded = encodeProgram(noteOnly)
    expect(v2(encoded)[0]).toBe(3)
    expect(decodeProgram(encoded)).toEqual({ ok: true, program: { ...noteOnly, id: 'shared' } })
  })

  it('reads a v2 body under a v3 version byte, since v3 only adds a flag', () => {
    const bytes = v2(GOLDEN_EXT_V2)
    bytes[0] = 3
    expect(decodeProgram(toB64(bytes))).toEqual({ ok: true, program: GOLDEN_EXT })
  })

  it('rejects bad v3 notes', () => {
    const one = (ext: number[]) => {
      const head = v2(encodeProgram(withIds({ ...GOLDEN_SIMPLE, days: GOLDEN_SIMPLE.days.map(() => empty()) })))
      const bytes = [3, ...head.slice(1, -7), 1, 2 << 3, 0, 101, ...ext, 0, 0, 0, 0, 0, 0]
      return decodeProgram(toB64(Uint8Array.from(bytes)))
    }
    const first = (res: ReturnType<typeof decodeProgram>) => res.ok && res.program.days[0].entries[0]
    const str = (s: string) => {
      const b = new TextEncoder().encode(s)
      return [b.length, ...b]
    }
    expect(first(one([0x40, ...str('seat 4')]))).toEqual({ id: 'e1', exerciseId: 101, sets: 3, note: 'seat 4' })
    expect(first(one([0x41, 8, ...str('tempo')]))).toEqual({ id: 'e1', exerciseId: 101, sets: 3, restSec: 120, note: 'tempo' })
    expect(one([0x40, ...str('')])).toEqual({ ok: false, error: 'malformed' })
    expect(one([0x40])).toEqual({ ok: false, error: 'malformed' })
    expect(one([0x80])).toEqual({ ok: false, error: 'malformed' })
    expect(one([0x40, ...str('x'.repeat(61))])).toEqual({ ok: false, error: 'invalid' })
  })

  it('keeps a fully specified week short', () => {
    const p = withIds({
      id: 'x',
      name: 'PPL',
      custom: [],
      days: Array.from({ length: 7 }, (_, d) => ({
        kind: 'train' as const,
        label: `Day ${d + 1}`,
        entries: Array.from({ length: 6 }, (_, k) => ({
          id: '',
          exerciseId: 100 + d * 10 + k,
          sets: 3,
          reps: '8-12',
          restSec: 90,
          rir: 2,
          ...(k % 2 ? { withPrev: true as const } : {}),
        })),
      })),
    })
    const encoded = encodeProgram(p)
    expect(encoded.length).toBeLessThan(560)
    expect(decodeProgram(encoded, { id: 'x' })).toEqual({ ok: true, program: p })
  })
})

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CODEC_EQUIPMENT_V1,
  CODEC_GROUPS_V1,
  SHARE_DAY_ENTRIES_MAX,
  SHARE_LINK_MAX,
  ShareLinkError,
  decodeProgram,
  encodeProgram,
} from './codec.ts'
import type { Day, Entry, Program } from './schema.ts'

const customIds = fc.uniqueArray(fc.integer({ min: 1, max: 63 }), { maxLength: 30 })

const entry = (refs: readonly (number | string)[]) =>
  fc.record(
    {
      exerciseId: refs.length ? fc.oneof(fc.integer({ min: 1, max: 65535 }), fc.constantFrom(...refs)) : fc.integer({ min: 1, max: 65535 }),
      sets: fc.integer({ min: 1, max: 20 }),
      reps: fc.string({ maxLength: 16 }),
      restSec: fc.integer({ min: 0, max: 40 }).map((n) => n * 15),
      rir: fc.integer({ min: 0, max: 5 }),
      withPrev: fc.constant(true as const),
      note: fc.string({ minLength: 1, maxLength: 60 }),
    },
    { requiredKeys: ['exerciseId', 'sets'] },
  )

const program = (maxEntries: number) =>
  customIds.chain((ids) => {
    const refs = ids.map((n) => `c${n}`)
    const day = fc.record(
      {
        kind: fc.constantFrom('rest' as const, 'train' as const),
        label: fc.string({ minLength: 1, maxLength: 24 }),
        note: fc.string({ minLength: 1, maxLength: 80 }),
        entries: fc.array(entry(refs), { maxLength: maxEntries }),
      },
      { requiredKeys: ['kind', 'entries'] },
    )
    const custom = fc.tuple(
      ...refs.map((id) =>
        fc.record({
          id: fc.constant(id),
          name: fc.string({ minLength: 1, maxLength: 40 }),
          equipment: fc.subarray([...CODEC_EQUIPMENT_V1]),
          laterality: fc.constantFrom('bilateral' as const, 'unilateral' as const, 'alternating' as const),
          groups: fc.dictionary(fc.constantFrom(...CODEC_GROUPS_V1), fc.constantFrom('primary' as const, 'secondary' as const)),
        }),
      ),
    )
    return fc.record({
      id: fc.constant('p'),
      name: fc.string({ minLength: 1, maxLength: 40 }),
      days: fc.array(day, { minLength: 7, maxLength: 7 }),
      custom,
    })
  })

type RawDay = Omit<Day, 'entries'> & { entries: Omit<Entry, 'id'>[] }

const withEntryIds = (p: Omit<Program, 'days'> & { days: RawDay[] }): Program => ({
  ...p,
  days: p.days.map((d) => ({ ...d, entries: d.entries.map((e, i) => ({ ...e, id: `e${i}` })) })),
})

describe('share codec round trip', () => {
  it('decodes every link it encodes', () => {
    fc.assert(
      fc.property(program(12), (raw) => {
        const p = withEntryIds(raw)
        expect(decodeProgram(encodeProgram(p)).ok).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  it('refuses programs a link cannot carry instead of returning a broken link', () => {
    fc.assert(
      fc.property(program(SHARE_DAY_ENTRIES_MAX + 40), (raw) => {
        const p = withEntryIds(raw)
        let link: string
        try {
          link = encodeProgram(p)
        } catch (e) {
          expect(e).toBeInstanceOf(ShareLinkError)
          return
        }
        expect(link.length).toBeLessThanOrEqual(SHARE_LINK_MAX)
        expect(decodeProgram(link).ok).toBe(true)
      }),
      { numRuns: 40 },
    )
  })

  it('rejects a day over the entry limit and a link over the length limit', () => {
    const day = (n: number, reps?: string): Day => ({
      kind: 'train',
      entries: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, exerciseId: 101, sets: 3, ...(reps ? { reps } : {}) })),
    })
    const rest: Day = { kind: 'rest', entries: [] }
    const base = { id: 'p', name: 'Big', custom: [] }
    expect(() => encodeProgram({ ...base, days: [day(SHARE_DAY_ENTRIES_MAX + 1), ...Array(6).fill(rest)] })).toThrow(ShareLinkError)
    expect(decodeProgram(encodeProgram({ ...base, days: [day(SHARE_DAY_ENTRIES_MAX), ...Array(6).fill(rest)] })).ok).toBe(true)
    expect(() => encodeProgram({ ...base, days: Array(7).fill(day(SHARE_DAY_ENTRIES_MAX, 'x'.repeat(16))) })).toThrow(ShareLinkError)
  })
})

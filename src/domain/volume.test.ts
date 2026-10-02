import { describe, expect, it } from 'vitest'
import type { Prefs } from './schema.ts'
import { BENCH, CATALOG, CURL, LEG_CURL, LUNGE, PUSH_UP, PUSHDOWN, programOf } from './test-fixtures.ts'
import { bandFor, classifyBand, computeWeek, dayIntensity, weekIntensity } from './volume.ts'

const prefs = (patch: Partial<Pick<Prefs, 'countingMode' | 'overrides'>> = {}) => ({
  countingMode: 'fractional' as const,
  overrides: {},
  ...patch,
})
const week = (program: ReturnType<typeof programOf>, p = prefs()) => computeWeek(program, { catalog: CATALOG, prefs: p })

describe('bands', () => {
  it.each([
    [0, 'none'],
    [0.5, 'light'],
    [3.5, 'light'],
    [4, 'moderate'],
    [9.5, 'moderate'],
    [10, 'target'],
    [10.0, 'target'],
    [20, 'target'],
    [20.5, 'high'],
    [30, 'high'],
    [30.5, 'very_high'],
  ] as const)('default edges: %s sets -> %s', (sets, band) => {
    expect(bandFor('chest', sets)?.band).toBe(band)
  })

  it.each([
    [1.5, 'light'],
    [2, 'moderate'],
    [5.5, 'moderate'],
    [6, 'target'],
    [16, 'target'],
    [16.5, 'high'],
    [24, 'high'],
    [24.5, 'very_high'],
  ] as const)('front delt override edges [2,6,16,24]: %s -> %s', (sets, band) => {
    expect(bandFor('front_delt', sets)?.band).toBe(band)
  })

  it.each([
    [0, 'none'],
    [0.5, 'moderate'],
    [3.5, 'moderate'],
    [4, 'moderate'],
    [5.5, 'moderate'],
    [6, 'target'],
    [16, 'target'],
    [17, 'high'],
    [26, 'high'],
    [27, 'very_high'],
  ] as const)('optional groups never read light: abs %s -> %s', (sets, band) => {
    expect(bandFor('abs', sets)?.band).toBe(band)
  })

  it('carries edges, sources and the optional flag', () => {
    expect(bandFor('chest', 12)).toEqual({
      band: 'target',
      value: 12,
      edges: [4, 10, 20, 30],
      cited: [4, 10, 20, 30],
      mode: 'normal',
      optional: false,
      sourceIds: ['pelland-2026', 'acsm-2026', 'baz-valle-2022'],
    })
    expect(bandFor('front_delt', 3)?.sourceIds).toEqual(['rp-2023'])
    expect(bandFor('glute_med', 1)?.optional).toBe(true)
  })

  it('returns null for unbanded groups', () => {
    expect(bandFor('serratus', 12)).toBeNull()
    expect(bandFor('rotator_cuff', 0)).toBeNull()
  })

  it('classifyBand handles optional mapping directly', () => {
    expect(classifyBand(1, [4, 10, 20, 30], true)).toBe('moderate')
    expect(classifyBand(1, [4, 10, 20, 30], false)).toBe('light')
  })
})

describe('computeWeek', () => {
  it('counts fractional sets per group and day', () => {
    const w = week(programOf({ 0: [[BENCH.id, 4]], 3: [[PUSH_UP.id, 3]] }))
    expect(w.daily.chest).toEqual([4, 0, 0, 3, 0, 0, 0])
    expect(w.weekly.chest).toBe(7)
    expect(w.daily.triceps).toEqual([2, 0, 0, 1.5, 0, 0, 0])
    expect(w.weekly.triceps).toBe(3.5)
    expect(w.weekly.front_delt).toBe(2)
    expect(w.weekly.quads).toBe(0)
    expect(w.bands.chest?.band).toBe('moderate')
    expect(w.bands.quads?.band).toBe('none')
    expect(w.bands.serratus).toBeNull()
  })

  it('lands fractional totals on exact band edges (9.5 vs 10.0)', () => {
    const nineteen = week(programOf({ 0: [[BENCH.id, 10]], 2: [[BENCH.id, 9]] }))
    expect(nineteen.weekly.triceps).toBe(9.5)
    expect(nineteen.bands.triceps?.band).toBe('moderate')
    const twenty = week(programOf({ 0: [[BENCH.id, 10]], 2: [[BENCH.id, 10]] }))
    expect(twenty.weekly.triceps).toBe(10)
    expect(twenty.bands.triceps?.band).toBe('target')
  })

  it('computes fractional frequency from the highest role weight per day', () => {
    const w = week(programOf({ 0: [[BENCH.id, 3]], 2: [[PUSH_UP.id, 3], [PUSHDOWN.id, 2]], 4: [[BENCH.id, 3]] }))
    expect(w.frequency.chest).toBe(3)
    expect(w.frequency.triceps).toBe(2) // 0.5 + 1 + 0.5
    expect(w.frequency.front_delt).toBe(1)
    expect(w.frequency.quads).toBe(0)
  })

  it('records visible math per contribution', () => {
    const p = programOf({ 1: [[BENCH.id, 3]] })
    const w = week(p)
    expect(w.contributions.triceps).toEqual([
      { entryId: p.days[1].entries[0].id, exerciseRef: BENCH.id, day: 1, sets: 3, role: 'secondary', weight: 0.5, value: 1.5 },
    ])
    expect(w.contributions.quads).toEqual([])
  })

  it('primary-only mode drops secondary work entirely', () => {
    const w = week(programOf({ 0: [[BENCH.id, 4]] }), prefs({ countingMode: 'primary' }))
    expect(w.weekly.chest).toBe(4)
    expect(w.weekly.triceps).toBe(0)
    expect(w.weekly.front_delt).toBe(0)
    expect(w.contributions.triceps).toEqual([])
    expect(w.frequency.triceps).toBe(0)
    expect(w.heads.weekly.triceps_long).toBe(0)
  })

  it('applies user overrides, including "none"', () => {
    const overrides = { [BENCH.id]: { triceps: 'none' as const, front_delt: 'primary' as const } }
    const w = week(programOf({ 0: [[BENCH.id, 4]] }), prefs({ overrides }))
    expect(w.weekly.triceps).toBe(0)
    expect(w.weekly.front_delt).toBe(4)
    expect(w.contributions.front_delt[0].weight).toBe(1)
  })

  it('counts unilateral sets once', () => {
    expect(LUNGE.laterality).toBe('unilateral')
    const w = week(programOf({ 0: [[LUNGE.id, 3]] }))
    expect(w.weekly.quads).toBe(3)
    expect(w.weekly.glute_max).toBe(3)
  })

  it('sums duplicate entries in a day', () => {
    const w = week(programOf({ 0: [[BENCH.id, 3], [BENCH.id, 4]] }))
    expect(w.daily.chest[0]).toBe(7)
    expect(w.contributions.chest).toHaveLength(2)
  })

  it('ignores rest days even when they still hold entries', () => {
    const w = week(programOf({ 0: { rest: true, entries: [[BENCH.id, 5]] }, 1: [[PUSH_UP.id, 2]] }))
    expect(w.daily.chest).toEqual([0, 2, 0, 0, 0, 0, 0])
    expect(w.entries.map((e) => e.day)).toEqual([1])
  })

  it('counts custom exercises and reports unresolved refs', () => {
    const custom = [{ id: 'c1', name: 'Band row', equipment: [], laterality: 'bilateral' as const, groups: { upper_back: 'primary' as const } }]
    const p = programOf({ 0: [['c1', 3], [999, 3], ['c2', 1]] }, custom)
    const w = week(p)
    expect(w.weekly.upper_back).toBe(3)
    expect(w.heads.weekly.rhomboids).toBe(3)
    expect(w.unresolved).toEqual([p.days[0].entries[1].id, p.days[0].entries[2].id])
  })

  it('shades heads with sets x role weight x emphasis, not normalized', () => {
    const w = week(programOf({ 0: [[BENCH.id, 4]], 2: [[CURL.id, 2]] }))
    expect(w.heads.weekly.pec_clavicular).toBe(2)
    expect(w.heads.weekly.pec_sternal).toBe(4)
    expect(w.heads.weekly.delt_anterior).toBe(2)
    expect(w.heads.weekly.triceps_long).toBe(2)
    expect(w.heads.weekly.brachialis).toBe(1)
    expect(w.heads.weekly.brachioradialis).toBe(1) // forearms secondary, omitted head = 1
    expect(w.heads.daily.pec_clavicular).toEqual([2, 0, 0, 0, 0, 0, 0])
  })

  it('draws deep heads on their parent as max(parent, deep)', () => {
    const w = week(programOf({ 0: [[LEG_CURL.id, 4]], 1: [[PUSHDOWN.id, 2]] }))
    expect(w.heads.weekly.biceps_femoris_long).toBe(2)
    expect(w.heads.weekly.biceps_femoris_short).toBe(4)
    expect(w.shade.weekly.biceps_femoris_long).toBe(4)
    expect(w.shade.daily.biceps_femoris_long).toEqual([4, 0, 0, 0, 0, 0, 0])
    expect(w.shade.weekly.semitendinosus).toBe(4)
    // pushdown: lateral 0.5, medial omitted = 1 -> lateral region draws the medial head
    expect(w.heads.weekly.triceps_lateral).toBe(1)
    expect(w.shade.weekly.triceps_lateral).toBe(2)
    expect(w.shade.weekly.triceps_long).toBe(1.5)
    // deep heads are never keys of the drawn map
    expect(w.shade.weekly.biceps_femoris_short).toBeUndefined()
    expect(w.shade.weekly.pec_minor).toBeUndefined()
  })

  it('keeps the parent value when it is higher than its deep head', () => {
    const w = week(programOf({ 0: [[BENCH.id, 4]] }))
    expect(w.heads.weekly.triceps_lateral).toBe(2)
    expect(w.shade.weekly.triceps_lateral).toBe(2)
  })
})

describe('intensity', () => {
  it('week scale is min(1, sqrt(W)/sqrt(30))', () => {
    expect(weekIntensity(0)).toBe(0)
    expect(weekIntensity(7.5)).toBeCloseTo(0.5, 10)
    expect(weekIntensity(30)).toBe(1)
    expect(weekIntensity(45)).toBe(1)
  })

  it('day scale is min(1, sqrt(E)/sqrt(10))', () => {
    expect(dayIntensity(0)).toBe(0)
    expect(dayIntensity(2.5)).toBeCloseTo(0.5, 10)
    expect(dayIntensity(10)).toBe(1)
    expect(dayIntensity(12)).toBe(1)
  })

  it('is precomputed for groups and drawn heads', () => {
    const w = week(programOf({ 0: [[BENCH.id, 5]], 3: [[BENCH.id, 10]] }))
    expect(w.weekly.triceps).toBe(7.5)
    expect(w.intensity.groups.weekly.triceps).toBeCloseTo(0.5, 10)
    expect(w.intensity.groups.daily.triceps[0]).toBeCloseTo(0.5, 10)
    expect(w.intensity.groups.daily.chest[3]).toBe(1)
    expect(w.intensity.heads.weekly.pec_sternal).toBeCloseTo(Math.sqrt(15 / 30), 10)
  })
})

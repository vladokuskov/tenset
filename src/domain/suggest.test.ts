import { describe, expect, it } from 'vitest'
import { suggestedSections, dayFit, labelFocus } from './suggest.ts'
import { BENCH, CURL, FIXTURES, ROW, SQUAT, catalogOf, fixtureExercise, programOf } from './test-fixtures.ts'
import { getGroup } from './taxonomy.ts'
import { computeWeek } from './volume.ts'

const CALF_RAISE = fixtureExercise(30, { name: 'Calf raise', pattern: 'plantarflexion', mechanic: 'isolation', groups: { calves: 'primary' } })
const CABLE_CURL = fixtureExercise(31, { name: 'Cable curl', pattern: 'elbow_flexion', equipment: ['cable'], mechanic: 'isolation', groups: { biceps: 'primary' } })
const catalog = catalogOf(...FIXTURES, CALF_RAISE, CABLE_CURL)
const weekOf = (days: Parameters<typeof programOf>[0]) =>
  computeWeek(programOf(days), { catalog, prefs: { countingMode: 'fractional', overrides: {} } })

const sections = (days: Parameters<typeof programOf>[0], day: number, extra: { label?: string; equipment?: string[]; exclude?: number[] } = {}) =>
  suggestedSections({ week: weekOf(days), goal: 'hypertrophy', catalog, equipment: extra.equipment ?? ['*'], day, ...extra })

describe('labelFocus', () => {
  it('reads template labels', () => {
    expect(labelFocus('Upper A')?.has('chest')).toBe(true)
    expect(labelFocus('Upper A')?.has('calves')).toBe(false)
    expect(labelFocus('Legs B')?.has('calves')).toBe(true)
    expect(labelFocus('Push')?.has('lats')).toBe(false)
    expect(labelFocus('Pull A')?.has('lats')).toBe(true)
    expect(labelFocus('Full body A')).toBeNull()
    expect(labelFocus('Monday session')).toBeNull()
    expect(labelFocus(undefined)).toBeNull()
  })
})

describe('dayFit', () => {
  it('reads the focus from the day muscles when the label says nothing', () => {
    const fit = dayFit(weekOf({ 0: [[BENCH.id, 3]] }), 0, undefined)
    expect(fit('chest')).toBe(2)
    expect(fit('lats')).toBe(2)
    expect(fit('calves')).toBe(0)
    expect(fit('abs')).toBe(1)
  })

  it('has no preference on an empty or full body day', () => {
    expect(dayFit(weekOf({}), 0, undefined)('calves')).toBe(1)
    expect(dayFit(weekOf({ 0: [[BENCH.id, 3]] }), 0, 'Full body A')('calves')).toBe(1)
  })
})

describe('suggestedSections', () => {
  it('puts not trained before below target on a day with no focus', () => {
    const out = sections({ 1: [[BENCH.id, 3]] }, 0)
    const order = out.map((s) => ['untrained', 'below', 'optional'].indexOf(s.kind))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(out.map((s) => s.kind)).toContain('below')
    expect(out[0]).toMatchObject({ kind: 'untrained', group: 'lats' })
  })

  it('does not lead with calves on an Upper day', () => {
    const days = { 0: { label: 'Upper A', entries: [[BENCH.id, 3]] as [number, number][] }, 1: [[CALF_RAISE.id, 2]] as [number, number][] }
    const groups = sections(days, 0, { label: 'Upper A' }).map((s) => s.group)
    expect(groups.indexOf('calves')).toBeGreaterThan(groups.indexOf('lats'))
    expect(groups.indexOf('calves')).toBeGreaterThan(groups.indexOf('biceps'))
    expect(groups[0]).not.toBe('calves')
  })

  it('leads with lower body groups on a Legs day', () => {
    const out = sections({ 0: { label: 'Legs' }, 2: [[BENCH.id, 3], [ROW.id, 3]] }, 0, { label: 'Legs' })
    expect(getGroup(out[0].group)?.area).toBe('lower')
  })

  it('favours groups the day already trains over gaps elsewhere in the body', () => {
    const out = sections({ 0: [[CURL.id, 2]], 2: [[SQUAT.id, 3]] }, 0)
    const at = (g: string) => out.findIndex((s) => s.group === g)
    expect(out[at('biceps')].kind).toBe('below')
    expect(at('biceps')).toBeLessThan(at('hamstrings'))
    expect(at('biceps')).toBeLessThan(at('glute_max'))
  })

  it('never repeats an exercise and leaves out the ones already on the day', () => {
    const out = sections({ 0: [[BENCH.id, 3]] }, 0, { exclude: [BENCH.id, CURL.id] })
    const ids = out.flatMap((s) => s.exerciseIds)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain(BENCH.id)
    expect(ids).not.toContain(CURL.id)
  })

  it('respects equipment', () => {
    const ids = sections({ 0: [[BENCH.id, 3]] }, 0, { equipment: [] }).flatMap((s) => s.exerciseIds)
    expect(ids).not.toContain(CABLE_CURL.id)
    expect(ids).not.toContain(ROW.id)
  })

  it('caps each section by its kind', () => {
    for (const s of sections({}, 0)) expect(s.exerciseIds.length).toBeLessThanOrEqual(s.kind === 'untrained' ? 3 : 2)
  })
})


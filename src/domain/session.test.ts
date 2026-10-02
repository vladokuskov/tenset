import { describe, expect, it } from 'vitest'
import type { ResolveContext } from './resolve.ts'
import type { CustomExercise, Day, Entry } from './schema.ts'
import { estimateDay, estimateSeconds, repsMidpoint } from './session.ts'
import { catalogOf, fixtureExercise } from './test-fixtures.ts'

const PRESS = fixtureExercise(1, { groups: { chest: 'primary' } })
const RAISE = fixtureExercise(2, { mechanic: 'isolation', defaults: { sets: 3, reps: '12-15' }, groups: { side_delt: 'primary' } })
const SPLIT = fixtureExercise(3, { laterality: 'unilateral', groups: { quads: 'primary' } })
const PLANK = fixtureExercise(4, { unit: 'seconds', mechanic: 'isolation', defaults: { sets: 3, reps: '30-60' }, groups: { abs: 'primary' } })
const MINE: CustomExercise = { id: 'c1', name: 'Mine', equipment: [], laterality: 'bilateral', groups: { chest: 'primary' } }

const ctx: ResolveContext = { catalog: catalogOf(PRESS, RAISE, SPLIT, PLANK), custom: [MINE], countingMode: 'fractional', overrides: {} }
let n = 0
const e = (exerciseId: Entry['exerciseId'], patch: Partial<Entry> = {}): Entry => ({ id: `e${n++}`, exerciseId, sets: 3, ...patch })
const day = (...entries: Entry[]): Day => ({ kind: 'train', entries })

describe('repsMidpoint', () => {
  it('reads ranges and single numbers', () => {
    expect(repsMidpoint('8-12')).toBe(10)
    expect(repsMidpoint(' 6 - 9 ')).toBe(7.5)
    expect(repsMidpoint('5')).toBe(5)
    expect(repsMidpoint('AMRAP')).toBeNull()
    expect(repsMidpoint(undefined)).toBeNull()
  })
})

describe('estimateSeconds', () => {
  it('is zero for rest and empty days', () => {
    expect(estimateSeconds({ kind: 'rest', entries: [e(1)] }, ctx)).toBe(0)
    expect(estimateDay(day(), ctx)).toBe(0)
  })

  it('times a single compound entry with the default rest', () => {
    // 60 setup + 3 x 30 s work + 2 x 120 s rest
    expect(estimateSeconds(day(e(1)), ctx)).toBe(390)
  })

  it('uses the entry reps and rest, falling back to the exercise default for text reps', () => {
    expect(estimateSeconds(day(e(1, { reps: '5', restSec: 180 })), ctx)).toBe(60 + 3 * 15 + 2 * 180)
    expect(estimateSeconds(day(e(1, { reps: 'AMRAP' })), ctx)).toBe(390)
  })

  it('uses isolation and custom rest defaults', () => {
    expect(estimateSeconds(day(e(2)), ctx)).toBe(60 + 3 * 13.5 * 3 + 2 * 75)
    expect(estimateSeconds(day(e('c1')), ctx)).toBe(60 + 3 * 30 + 2 * 90)
  })

  it('doubles work for unilateral and counts seconds as time', () => {
    expect(estimateSeconds(day(e(3)), ctx)).toBe(60 + 3 * 60 + 2 * 120)
    expect(estimateSeconds(day(e(4)), ctx)).toBe(60 + 3 * 45 + 2 * 75)
  })

  it('shares setup and rest inside a superset', () => {
    const a = e(1, { sets: 3 })
    const b = e(2, { sets: 4, withPrev: true })
    // 120 setup + 90 + 162 work + 3 rounds x (15 + 120)
    expect(estimateSeconds(day(a, b), ctx)).toBe(120 + 90 + 162 + 3 * 135)
    expect(estimateSeconds(day(a, b), ctx)).toBeLessThan(estimateSeconds(day(a, { ...b, withPrev: undefined }), ctx))
  })

  it('skips unknown exercises', () => {
    expect(estimateSeconds(day(e(99), e(1)), ctx)).toBe(390)
    expect(estimateSeconds(day(e(1), e(99, { withPrev: true })), ctx)).toBe(390)
    expect(estimateDay(day(e(99)), ctx)).toBe(0)
  })
})

describe('estimateDay', () => {
  it('rounds to 5 minutes with a minimum of 5', () => {
    expect(estimateDay(day(e(1, { sets: 1 })), ctx)).toBe(5)
    expect(estimateDay(day(e(1), e(1), e(1), e(1), e(1)), ctx)).toBe(35)
  })
})

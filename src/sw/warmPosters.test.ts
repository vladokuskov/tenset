import { describe, expect, it } from 'vitest'
import { activeExercises, catalog, exerciseBySlug } from '../data/catalog'
import type { CustomExercise } from '../domain/schema'
import { programOf } from '../domain/test-fixtures'
import { alternativesFor } from '../domain/alternatives'
import { posterUrl } from '../data/posters'
import { programPosters, type WarmPrefs } from './warmPosters'

const prefs: WarmPrefs = { equipment: ['barbell', 'dumbbell', 'flat_bench', 'adjustable_bench', 'rack', 'cable'], countingMode: 'fractional', overrides: {} }
const bench = exerciseBySlug.get('barbell-bench-press')!

describe('programPosters', () => {
  it('covers each exercise in the programs and the alternatives its detail page lists', () => {
    const custom: CustomExercise = { id: 'c1', name: 'Mine', equipment: [], laterality: 'bilateral', groups: { chest: 'primary' } }
    const program = programOf({ 0: [[bench.id, 3], ['c1', 3]], 2: [[bench.id, 2]] }, [custom])
    const urls = programPosters([program], prefs)

    const shown = [bench, ...alternativesFor(bench, activeExercises, [...prefs.equipment], { catalog, custom: [], countingMode: 'fractional', overrides: {} }).map((a) => a.exercise)]
    const expected = shown.filter((e) => e.media.status === 'loop').map((e) => posterUrl(e.id))
    expect(expected.length).toBeGreaterThan(1)
    expect(urls.toSorted()).toEqual(expected.toSorted())
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('is empty without programs', () => {
    expect(programPosters([], prefs)).toEqual([])
  })
})

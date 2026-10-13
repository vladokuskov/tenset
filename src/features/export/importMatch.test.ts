import { describe, expect, it } from 'vitest'
import { activeExercises } from '../../data/catalog'
import { localizeExercise } from '../../data/localize'
import type { CustomExercise } from '../../domain/schema'
import { cleanQuery, createMatcher } from './importMatch'

const slugOf = (ref: unknown) => activeExercises.find((e) => e.id === ref)?.slug
const custom: CustomExercise[] = [{ id: 'c1', name: 'Sled push', equipment: [], laterality: 'bilateral', groups: { quads: 'primary' } }]
const matcher = createMatcher(activeExercises, custom, 'en')

describe('import matcher', () => {
  it('strips set and rep tokens', () => {
    expect(cleanQuery('Bench press 3x8-10')).toBe('Bench press')
    expect(cleanQuery('Squat 5x5 @ RIR 2')).toBe('Squat')
  })

  it('matches aliases exactly', () => {
    const r = matcher.match('Bench press')
    expect(r.confidence).toBe('exact')
    expect(slugOf(r.best?.ref)).toBe('barbell-bench-press')
    expect(r.alternatives.length).toBeGreaterThan(0)
    expect(r.alternatives.length).toBeLessThanOrEqual(3)
    expect(slugOf(matcher.match('RDL 3x8').best?.ref)).toBe('barbell-romanian-deadlift')
  })

  it('finds a plural or loose name', () => {
    const r = matcher.match('squats')
    expect(r.best).not.toBeNull()
    expect(r.confidence).not.toBe('none')
  })

  it('flags names it is not sure about and finds nothing for nonsense', () => {
    expect(matcher.match('zqxw blorp').confidence).toBe('none')
    const r = matcher.match('Cable thing')
    expect(['weak', 'none']).toContain(r.confidence)
  })

  it('finds no match when a name shares only a broad word with an exercise', () => {
    for (const name of ["Farmer's walk", 'Sled push 4x20m', 'Box jump']) {
      const r = createMatcher(activeExercises, [], 'en').match(name)
      expect(r, name).toMatchObject({ best: null, confidence: 'none' })
    }
    expect(matcher.match('Weighted pullups').best).not.toBeNull()
    expect(matcher.match('Cable fly').best).not.toBeNull()
  })

  it('prefers the program custom exercises by name', () => {
    expect(matcher.match('sled push')).toMatchObject({ best: { ref: 'c1' }, confidence: 'exact' })
  })

  it('matches Ukrainian and English names in the localized catalog', () => {
    const uk = activeExercises.map((e) => localizeExercise(e, 'uk'))
    const ukMatcher = createMatcher(uk, [], 'uk')
    const bench = uk.find((e) => e.slug === 'barbell-bench-press')!
    expect(ukMatcher.match(bench.name).best?.ref).toBe(bench.id)
    expect(ukMatcher.match('Barbell Bench Press').best?.ref).toBe(bench.id)
  })

  it('searches for a replacement pick', () => {
    const hits = matcher.search('pulldown')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.length).toBeLessThanOrEqual(6)
    expect(matcher.search('sled')[0].ref).toBe('c1')
    expect(matcher.search('')).toEqual([])
  })
})

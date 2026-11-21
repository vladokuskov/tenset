import { describe, expect, it } from 'vitest'
import { presetEquipment } from '../../domain/equipment'
import { activeExercises } from '../../data/catalog'
import { groupName, localizeExercise } from '../../data/localize'
import { catalogMessages } from './messages'
import { movementGroupOf, PATTERN_GROUPS, patternLabel } from './patterns'
import { buildIndex, filterExercises, tokenize } from './search'

const index = buildIndex(activeExercises)
const slugs = (list: { slug: string }[]) => list.map((e) => e.slug)

describe('catalog search', () => {
  it('finds exercises by alias', () => {
    expect(slugs(filterExercises(activeExercises, index, { q: 'RDL' }))).toContain('barbell-romanian-deadlift')
    expect(slugs(filterExercises(activeExercises, index, { q: 'ohp' }))[0]).toBe('barbell-overhead-press')
  })

  it('matches hyphenated names with or without the hyphen', () => {
    expect(tokenize('Pull-up bar')).toEqual(['pull', 'up', 'pullup', 'bar'])
    const a = slugs(filterExercises(activeExercises, index, { q: 'pullup' }))
    expect(a.some((s) => s.includes('pull-up'))).toBe(true)
  })

  it('matches muscles and equipment', () => {
    const chest = filterExercises(activeExercises, index, { q: 'chest' })
    expect(chest.length).toBeGreaterThan(5)
    expect(chest[0].groups.chest).toBe('primary')
    const cable = filterExercises(activeExercises, index, { q: 'cable' })
    expect(cable.every((e) => e.equipment.includes('cable') || /cable/i.test(e.name + e.aliases.join()))).toBe(true)
  })

  it('combines filters', () => {
    const bw = presetEquipment('bodyweight')
    const list = filterExercises(activeExercises, index, { available: bw, muscle: 'lats' })
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((e) => e.equipment.every((x) => bw.includes(x)) && e.groups.lats === 'primary')).toBe(true)
  })

})

describe('catalog search in Ukrainian', () => {
  const uk = activeExercises.map((e) => localizeExercise(e, 'uk'))
  const ukIndex = buildIndex(uk, 'uk')

  it('folds every apostrophe form', () => {
    expect(tokenize('Мʼяз')).toEqual(['мяз'])
    expect(tokenize("м'яз")).toEqual(['мяз'])
    expect(tokenize('м’яз')).toEqual(['мяз'])
  })

  it('finds a hand-made localized record by name, alias and English name', () => {
    const base = activeExercises.find((e) => e.slug === 'barbell-bench-press')!
    const record = { ...base, name: 'Жим штанги лежачи', aliases: ['мʼязовий жим', base.name, ...base.aliases] }
    const index = buildIndex([record], 'uk')
    for (const q of ['жим', 'штанги', "м'язовий", 'bench']) expect(filterExercises([record], index, { q }), q).toEqual([record])
  })

  it('finds translated exercises and Ukrainian group names', () => {
    if (uk.some((e) => /[а-яіїєґ]/i.test(e.name))) {
      expect(filterExercises(uk, ukIndex, { q: 'жим' }).length).toBeGreaterThan(0)
    }
    const chest = filterExercises(uk, ukIndex, { q: groupName('chest', 'uk') })
    expect(chest.length).toBeGreaterThan(5)
    expect(chest[0].groups.chest).toBe('primary')
    expect(slugs(filterExercises(uk, ukIndex, { q: 'RDL' }))).toContain('barbell-romanian-deadlift')
  })

  it('indexes localized pattern labels', () => {
    const hits = filterExercises(uk, ukIndex, { q: patternLabel('squat', 'uk') })
    expect(hits.some((e) => e.pattern === 'squat')).toBe(true)
  })
})

describe('labels', () => {
  it('labels every pattern in both languages', () => {
    expect(PATTERN_GROUPS.flatMap((g) => g.patterns).sort()).toEqual(Object.keys(catalogMessages.en.pattern).sort())
    expect(Object.keys(catalogMessages.uk.pattern).sort()).toEqual(Object.keys(catalogMessages.en.pattern).sort())
  })
})

describe('movement filter', () => {
  it('keeps only exercises whose pattern is in the group', () => {
    const legs = filterExercises(activeExercises, index, { move: 'legs' })
    expect(legs.length).toBeGreaterThan(0)
    expect(legs.every((e) => movementGroupOf(e.pattern) === 'legs')).toBe(true)
    expect(slugs(legs)).toContain('barbell-romanian-deadlift')
  })

  it('splits the catalog without overlap', () => {
    const total = PATTERN_GROUPS.reduce((n, g) => n + filterExercises(activeExercises, index, { move: g.id }).length, 0)
    expect(total).toBe(filterExercises(activeExercises, index, {}).length)
  })

  it('narrows a search', () => {
    expect(filterExercises(activeExercises, index, { q: 'RDL', move: 'push' })).toEqual([])
  })
})

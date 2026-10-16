import { describe, expect, it } from 'vitest'
import { activeExercises } from '../../data/catalog'
import { groupName, localizeExercise } from '../../data/localize'
import { presetEquipment } from '../../domain/equipment'
import { blankProgram } from '../../domain/program'
import type { ResolveContext } from '../../domain/resolve'
import type { CustomExercise } from '../../domain/schema'
import { catalogOf, fixtureExercise } from '../../domain/test-fixtures'
import { alternativesFor, headOverlap, headVector, rankAlternatives } from '../../domain/alternatives'
import { lightestTrainingDay, shortCite } from './detail'
import { exerciseGroup } from './media'
import { catalogMessages } from './messages'
import { movementGroupOf, PATTERN_GROUPS, patternLabel } from './patterns'
import { applyOverride, isCustomized } from './roles'
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
    const hinge = filterExercises(activeExercises, index, { pattern: 'hinge', level: 1 })
    expect(hinge.every((e) => e.pattern === 'hinge' && e.level === 1)).toBe(true)
  })

  it('applies muscle overrides to the muscle filter', () => {
    const bench = activeExercises.find((e) => e.slug === 'barbell-bench-press')!
    const before = filterExercises(activeExercises, index, { muscle: 'triceps' })
    expect(before).not.toContain(bench)
    const after = filterExercises(activeExercises, index, { muscle: 'triceps' }, { [bench.id]: { triceps: 'primary' } })
    expect(after).toContain(bench)
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

describe('roles', () => {
  it('applies and detects overrides', () => {
    const groups = { chest: 'primary', triceps: 'secondary' } as const
    expect(applyOverride(groups, { triceps: 'none', front_delt: 'secondary' })).toEqual({ chest: 'primary', front_delt: 'secondary' })
    expect(isCustomized(groups, { chest: 'primary' })).toBe(false)
    expect(isCustomized(groups, { biceps: 'none' })).toBe(false)
    expect(isCustomized(groups, { triceps: 'primary' })).toBe(true)
  })
})

const altCtx = (patch: Partial<ResolveContext> = {}): ResolveContext => ({
  catalog: catalogOf(...activeExercises),
  custom: [],
  countingMode: 'fractional',
  overrides: {},
  ...patch,
})

describe('alternatives', () => {
  it('keeps the pattern and puts available equipment first', () => {
    const bench = activeExercises.find((e) => e.slug === 'barbell-bench-press')!
    const alts = alternativesFor(bench, activeExercises, presetEquipment('dumbbells_bench'), altCtx())
    expect(alts.length).toBeGreaterThan(0)
    expect(alts.map((a) => a.exercise.id)).not.toContain(bench.id)
    const firstUnavailable = alts.findIndex((a) => !a.available)
    if (firstUnavailable >= 0) expect(alts.slice(firstUnavailable).every((a) => !a.available)).toBe(true)
  })
})

describe('rankAlternatives', () => {
  const flat = fixtureExercise(1, { groups: { chest: 'primary', triceps: 'secondary' }, heads: { pec_clavicular: 0.5, pec_sternal: 1 } })
  const incline = fixtureExercise(2, { groups: { chest: 'primary', triceps: 'secondary' }, heads: { pec_clavicular: 1, pec_sternal: 0.5 } })
  const decline = fixtureExercise(3, { groups: { chest: 'primary', triceps: 'secondary' }, heads: { pec_clavicular: 0.25, pec_sternal: 1 } })
  const dip = fixtureExercise(4, { groups: { triceps: 'primary', chest: 'secondary' }, level: 3 })
  const cable = fixtureExercise(5, { groups: { chest: 'primary' }, heads: { pec_sternal: 1 }, equipment: ['cable'] })
  const ctx = (patch: Partial<ResolveContext> = {}) => altCtx({ catalog: catalogOf(flat, incline, decline, dip, cable), ...patch })
  const ids = (list: { exercise: { id: number | string } }[]) => list.map((r) => r.exercise.id)

  it('ranks by head overlap after equipment', () => {
    expect(ids(rankAlternatives(flat, [incline, dip, decline, cable], ctx(), []))).toEqual([3, 2, 4, 5])
  })

  it('puts the curated list before overlap', () => {
    const target = { ...flat, alternatives: [4] }
    expect(ids(rankAlternatives(target, [incline, dip, decline], ctx(), []))[0]).toBe(4)
  })

  it('follows overrides and counting mode', () => {
    const base = headOverlap(headVector(flat, ctx()), headVector(dip, ctx()))
    const primaryOnly = headOverlap(headVector(flat, ctx({ countingMode: 'primary' })), headVector(dip, ctx({ countingMode: 'primary' })))
    expect(primaryOnly).toBe(0)
    expect(base).toBeGreaterThan(0)
    const moved = ctx({ overrides: { '4': { chest: 'primary', triceps: 'secondary' } } })
    expect(headOverlap(headVector(flat, moved), headVector(dip, moved))).toBeGreaterThan(base)
  })

  it('handles custom exercises', () => {
    const mine: CustomExercise = { id: 'c1', name: 'Mine', equipment: [], laterality: 'bilateral', groups: { chest: 'primary' } }
    const ranked = rankAlternatives(mine, [dip, decline], ctx({ custom: [mine] }), [])
    expect(ids(ranked)).toEqual([3, 4])
    expect(ranked[0].overlap).toBeGreaterThan(0)
  })
})

describe('detail helpers', () => {
  it('picks the lightest training day in display order', () => {
    const p = blankProgram('p', 'Test', [0, 2, 4])
    p.days[0].entries.push({ id: 'a', exerciseId: 101, sets: 4 })
    p.days[4].entries.push({ id: 'b', exerciseId: 101, sets: 2 })
    expect(lightestTrainingDay(p, 0)).toBe(2)
    p.days[2].entries.push({ id: 'c', exerciseId: 101, sets: 2 })
    expect(lightestTrainingDay(p, 0)).toBe(2)
    expect(lightestTrainingDay(p, 3)).toBe(4)
    expect(lightestTrainingDay(blankProgram('q', 'Rest', []), 0)).toBeNull()
  })

  it('shortens citations', () => {
    expect(shortCite('rodriguez-ridao-2020')).toBe('Rodriguez-Ridao et al. 2020')
    expect(shortCite('schoenfeld-2017')).toBe('Schoenfeld 2017')
    expect(shortCite('anatomy-general')).toBe('Standard functional anatomy')
  })

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

  it('colors custom exercises as other', () => {
    const mine: CustomExercise = { id: 'c1', name: 'Mine', equipment: [], laterality: 'bilateral', groups: { chest: 'primary' } }
    expect(exerciseGroup(mine)).toBe('other')
    expect(exerciseGroup(activeExercises.find((e) => e.pattern === 'squat')!)).toBe('legs')
  })
})

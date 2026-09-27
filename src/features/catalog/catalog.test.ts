import { describe, expect, it } from 'vitest'
import { activeExercises } from '../../data/catalog'
import { presetEquipment } from '../../domain/equipment'
import { blankProgram } from '../../domain/program'
import { alternativesFor } from './alternatives'
import { lightestTrainingDay, shortCite } from './detail'
import { PATTERN_GROUPS, PATTERN_LABEL } from './patterns'
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

describe('roles', () => {
  it('applies and detects overrides', () => {
    const groups = { chest: 'primary', triceps: 'secondary' } as const
    expect(applyOverride(groups, { triceps: 'none', front_delt: 'secondary' })).toEqual({ chest: 'primary', front_delt: 'secondary' })
    expect(isCustomized(groups, { chest: 'primary' })).toBe(false)
    expect(isCustomized(groups, { biceps: 'none' })).toBe(false)
    expect(isCustomized(groups, { triceps: 'primary' })).toBe(true)
  })
})

describe('alternatives', () => {
  it('keeps the pattern and puts available equipment first', () => {
    const bench = activeExercises.find((e) => e.slug === 'barbell-bench-press')!
    const alts = alternativesFor(bench, activeExercises, presetEquipment('dumbbells_bench'))
    expect(alts.length).toBeGreaterThan(0)
    expect(alts.map((a) => a.exercise.id)).not.toContain(bench.id)
    const firstUnavailable = alts.findIndex((a) => !a.available)
    if (firstUnavailable >= 0) expect(alts.slice(firstUnavailable).every((a) => !a.available)).toBe(true)
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

  it('labels every pattern and groups each once', () => {
    const grouped = PATTERN_GROUPS.flatMap((g) => g.patterns)
    expect(new Set(grouped).size).toBe(grouped.length)
    expect(grouped.sort()).toEqual(Object.keys(PATTERN_LABEL).sort())
  })
})

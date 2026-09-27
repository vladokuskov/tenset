import { describe, expect, it } from 'vitest'
import type { ResolveContext } from '../../../domain/resolve'
import { BENCH, CATALOG, CURL, SQUAT, programOf } from '../../../domain/test-fixtures'
import { entriesTraining, litCss, trainedGroups } from './coupling'

const ctx = (patch: Partial<ResolveContext> = {}): ResolveContext => ({
  catalog: CATALOG,
  custom: [],
  countingMode: 'fractional',
  overrides: {},
  ...patch,
})

describe('entriesTraining', () => {
  const program = programOf({
    0: [
      [BENCH.id, 3],
      [SQUAT.id, 3],
    ],
    2: { rest: true, entries: [[BENCH.id, 3]] },
    3: [[CURL.id, 2]],
  })

  it('lists entries on training days with the role the group plays', () => {
    expect(entriesTraining(program, 'chest', ctx())).toEqual([{ id: 'e1', day: 0, role: 'primary' }])
    expect(entriesTraining(program, 'triceps', ctx())).toEqual([{ id: 'e1', day: 0, role: 'secondary' }])
  })

  it('skips rest days, whose entries do not count', () => {
    expect(entriesTraining(program, 'chest', ctx()).map((e) => e.day)).not.toContain(2)
  })

  it('drops secondaries in primary-only counting and follows overrides', () => {
    expect(entriesTraining(program, 'triceps', ctx({ countingMode: 'primary' }))).toEqual([])
    const overrides = { [String(BENCH.id)]: { triceps: 'primary' as const } }
    expect(entriesTraining(program, 'triceps', ctx({ overrides }))).toEqual([{ id: 'e1', day: 0, role: 'primary' }])
  })
})

describe('trainedGroups', () => {
  it('keeps groups with sets, most first, ties by id', () => {
    expect(trainedGroups({ chest: 3, lats: 0, biceps: 6, abs: 3 })).toEqual(['biceps', 'abs', 'chest'])
  })
})

describe('litCss', () => {
  it('fades every card and rings lit ones by role', () => {
    const css = litCss('[x]', [
      { id: 'a1', day: 0, role: 'primary' },
      { id: 'b2', day: 1, role: 'secondary' },
    ])
    expect(css).toContain('[x] a[href*="sheet=entry"]{opacity:.4')
    expect(css).toContain('[x] a[href*="sheet=entry"][href*="entry=a1&"]{opacity:1;box-shadow:0 0 0 2px var(--color-accent)}')
    expect(css).toMatch(/\[href\*="entry=b2&"\]\{opacity:1;box-shadow:0 0 0 2px color-mix/)
  })

  it('matches whole entry ids, so e1 does not light e12', () => {
    const css = litCss('[x]', [{ id: 'e1', day: 0, role: 'primary' }])
    expect(css).toContain('[href$="entry=e1"]')
    expect(css).not.toMatch(/\[href\*="e1"\]/)
  })

  it('only fades when nothing trains the group', () => {
    expect(litCss('[x]', []).split('\n')).toHaveLength(1)
  })
})

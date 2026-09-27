import { describe, expect, it } from 'vitest'
import type { ResolveContext } from '../../../domain/resolve'
import { BENCH, CATALOG, CURL, SQUAT, programOf } from '../../../domain/test-fixtures'
import { entriesTraining, trainedGroups } from './coupling'

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

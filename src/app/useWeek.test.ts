import { describe, expect, it } from 'vitest'
import { emptyMix, movementMix } from '../domain/movement'
import { BENCH, CATALOG, CURL, ROW, SQUAT, programOf } from '../domain/test-fixtures'
import { computeWeek } from '../domain/volume'
import { summarize } from './useWeek'

const prefs = { countingMode: 'fractional' as const, overrides: {} }

describe('day summaries', () => {
  it('counts sets per movement group for each day, custom exercises under other', () => {
    const program = programOf(
      {
        0: [
          [BENCH.id, 3],
          [ROW.id, 4],
          ['c1', 2],
        ],
        2: { rest: true, entries: [[SQUAT.id, 5]] },
        4: [
          [SQUAT.id, 4],
          [CURL.id, 2],
        ],
      },
      [{ id: 'c1', name: 'Sled push', equipment: [], laterality: 'bilateral', groups: { quads: 'primary' } }],
    )
    const week = computeWeek(program, { catalog: CATALOG, prefs })
    const days = summarize(program, week, 'en', { catalog: CATALOG, custom: program.custom, ...prefs })

    expect(days[0].mix).toEqual({ ...emptyMix(), push: 3, pull: 4, other: 2 })
    expect(days[1].mix).toEqual(emptyMix())
    expect(days[2].mix).toEqual(emptyMix())
    expect(days[4].mix).toEqual({ ...emptyMix(), legs: 4, arms: 2 })
    expect(movementMix(week.entries)).toEqual({ ...emptyMix(), push: 3, pull: 4, legs: 4, arms: 2, other: 2 })
  })
})

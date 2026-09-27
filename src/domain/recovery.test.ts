import { describe, expect, it } from 'vitest'
import { dayFacts, groupSchedule, weekSchedule } from './recovery.ts'
import { BENCH, CATALOG, PUSH_UP, programOf } from './test-fixtures.ts'
import { computeWeek } from './volume.ts'

describe('groupSchedule', () => {
  it('lists trained days with cyclic gaps', () => {
    expect(groupSchedule('chest', [4, 0, 0, 4, 0, 4, 0])).toEqual({ group: 'chest', days: [0, 3, 5], gaps: [3, 2, 2] })
  })

  it('wraps Sunday into Monday', () => {
    expect(groupSchedule('chest', [3, 0, 0, 0, 0, 3, 3])).toEqual({ group: 'chest', days: [0, 5, 6], gaps: [5, 1, 1] })
  })

  it('orders from the display week start', () => {
    expect(groupSchedule('chest', [3, 0, 0, 0, 0, 3, 3], 6)).toEqual({ group: 'chest', days: [6, 0, 5], gaps: [1, 5, 1] })
  })

  it('gives a 7 day gap for a single session and nothing for none', () => {
    expect(groupSchedule('chest', [0, 0, 5, 0, 0, 0, 0]).gaps).toEqual([7])
    expect(groupSchedule('chest', [0, 0, 0, 0, 0, 0, 0])).toEqual({ group: 'chest', days: [], gaps: [] })
  })

  it('needs at least 2 effective sets on a day', () => {
    expect(groupSchedule('triceps', [1.5, 2, 0, 0, 0, 0, 0]).days).toEqual([1])
  })
})

describe('weekSchedule', () => {
  it('covers only trained groups', () => {
    const w = computeWeek(programOf({ 0: [[BENCH.id, 4]], 3: [[BENCH.id, 4]] }), {
      catalog: CATALOG,
      prefs: { countingMode: 'fractional', overrides: {} },
    })
    const s = weekSchedule(w.daily)
    expect(s.map((x) => x.group).sort()).toEqual(['chest', 'front_delt', 'triceps'])
    expect(s.find((x) => x.group === 'chest')).toEqual({ group: 'chest', days: [0, 3], gaps: [3, 4] })
  })
})

describe('dayFacts', () => {
  const daily = {
    chest: [6, 0, 0, 0, 0, 0, 8],
    triceps: [3, 0, 0, 3, 0, 0, 0],
    quads: [5, 0, 0, 0, 0, 0, 0],
    calves: [0, 0, 0, 0, 0, 0, 1],
  }

  it('reports the nearest earlier trained day, wrapping into last week', () => {
    expect(dayFacts(daily, 0)).toEqual([
      { group: 'chest', day: 0, previousDay: 6, daysEarlier: 1, sets: 8 },
      { group: 'triceps', day: 0, previousDay: 3, daysEarlier: 4, sets: 3 },
    ])
  })

  it('skips groups not trained that day or trained only once', () => {
    expect(dayFacts(daily, 2)).toEqual([])
    expect(dayFacts(daily, 0).some((f) => f.group === 'quads')).toBe(false)
  })

  it('is information only: no severity or warning fields', () => {
    const fact = dayFacts(daily, 6)[0]
    expect(Object.keys(fact).sort()).toEqual(['day', 'daysEarlier', 'group', 'previousDay', 'sets'])
    expect(Object.keys(groupSchedule('chest', daily.chest)).sort()).toEqual(['days', 'gaps', 'group'])
  })

  it('works from computeWeek output', () => {
    const w = computeWeek(programOf({ 5: [[PUSH_UP.id, 4]], 6: [[BENCH.id, 4]] }), {
      catalog: CATALOG,
      prefs: { countingMode: 'fractional', overrides: {} },
    })
    expect(dayFacts(w.daily, 6)).toEqual([
      { group: 'chest', day: 6, previousDay: 5, daysEarlier: 1, sets: 4 },
      { group: 'triceps', day: 6, previousDay: 5, daysEarlier: 1, sets: 2 },
    ])
  })
})

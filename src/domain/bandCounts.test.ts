import { describe, expect, it } from 'vitest'
import { bandCounts } from './bandCounts.ts'
import { BENCH, CATALOG, ROW, programOf } from './test-fixtures.ts'
import { computeWeek } from './volume.ts'
import type { Targets } from './targets.ts'

const weekOf = (days: Parameters<typeof programOf>[0], targets?: Targets) =>
  computeWeek(programOf(days), { catalog: CATALOG, prefs: { countingMode: 'fractional', overrides: {}, targets } })

describe('bandCounts', () => {
  it('counts main groups by band, not by whether they have sets', () => {
    // Chest at 12 and front delts at 6 are in range; the rest sit below, some with sets.
    const c = bandCounts(weekOf({ 0: [[BENCH.id, 6], [ROW.id, 3]], 3: [[BENCH.id, 6]] }))
    expect(c.total).toBe(12)
    expect(c.inTarget).toBe(2)
    expect(c.above).toBe(0)
    expect(c.below).toHaveLength(10)
    expect(c.below).toContain('triceps')
    expect(c.below).not.toContain('chest')
    expect(c.below).not.toContain('abs')
  })

  it('lists below-target groups with the fewest sets first', () => {
    const c = bandCounts(weekOf({ 0: [[BENCH.id, 3], [ROW.id, 5]] }))
    const sets = c.below.map((g) => weekOf({ 0: [[BENCH.id, 3], [ROW.id, 5]] }).weekly[g])
    expect(sets).toEqual([...sets].sort((a, b) => a - b))
  })

  it('counts groups above the range', () => {
    const c = bandCounts(weekOf({ 0: [[BENCH.id, 10]], 2: [[BENCH.id, 10]], 4: [[BENCH.id, 10]] }))
    expect(c.above).toBe(1)
  })

  it('leaves out skipped groups', () => {
    const c = bandCounts(weekOf({}, { calves: { mode: 'skip' } }))
    expect(c.total).toBe(11)
    expect(c.below).not.toContain('calves')
  })
})

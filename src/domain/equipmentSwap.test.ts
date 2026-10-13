import { describe, expect, it } from 'vitest'
import { applyEquipmentSwap, planEquipmentSwap } from './equipmentSwap.ts'
import { BENCH, PUSH_UP, ROW, catalogOf, fixtureExercise, programOf } from './test-fixtures.ts'

const DB_BENCH = fixtureExercise(30, {
  name: 'DB bench',
  equipment: ['dumbbell', 'flat_bench'],
  groups: { chest: 'primary', front_delt: 'secondary', triceps: 'secondary' },
})
const MACHINE_PRESS = fixtureExercise(31, {
  name: 'Machine press',
  equipment: ['chest_press_machine'],
  groups: { chest: 'primary', triceps: 'secondary' },
})
const DB_ROW = fixtureExercise(32, {
  name: 'DB row',
  pattern: 'horizontal_pull',
  equipment: ['dumbbell'],
  groups: { upper_back: 'primary', biceps: 'secondary' },
})
const RETIRED_DB = fixtureExercise(33, {
  name: 'Old DB press',
  equipment: ['dumbbell'],
  status: 'retired',
  groups: { chest: 'primary', front_delt: 'secondary', triceps: 'secondary' },
})

const ALL = [BENCH, PUSH_UP, ROW, DB_BENCH, MACHINE_PRESS, DB_ROW, RETIRED_DB]
const catalog = catalogOf(...ALL)
const HOME = ['dumbbell', 'flat_bench']

describe('planEquipmentSwap', () => {
  it('picks the closest alternative the equipment allows and leaves fitting entries alone', () => {
    const program = programOf({ 0: [[BENCH.id, 3], [PUSH_UP.id, 2]] })
    const plan = planEquipmentSwap(program, catalog, ALL, HOME)
    expect(plan.swaps).toEqual([{ entryId: 'e1', day: 0, from: BENCH.id, to: DB_BENCH.id }])
    expect(plan.unmatched).toBe(0)
  })

  it('follows the curated alternatives first', () => {
    const bench = { ...BENCH, alternatives: [PUSH_UP.id] }
    const plan = planEquipmentSwap(programOf({ 0: [[bench.id, 3]] }), catalogOf(bench, PUSH_UP, DB_BENCH), [bench, PUSH_UP, DB_BENCH], HOME)
    expect(plan.swaps.map((s) => s.to)).toEqual([PUSH_UP.id])
  })

  it('never drops a primary group of the original', () => {
    // DB row has upper back but not lats, so the cable row stays as it is.
    const plan = planEquipmentSwap(programOf({ 1: [[ROW.id, 3]] }), catalog, ALL, HOME)
    expect(plan.swaps).toEqual([])
    expect(plan.unmatched).toBe(1)
  })

  it('skips retired exercises', () => {
    const plan = planEquipmentSwap(programOf({ 0: [[BENCH.id, 3]] }), catalog, ALL, ['dumbbell'])
    expect(plan.swaps.map((s) => s.to)).toEqual([PUSH_UP.id])
  })

  it('does not turn two entries of one day into the same exercise when another fits', () => {
    const program = programOf({ 0: [[BENCH.id, 3], [BENCH.id, 3]], 1: [[BENCH.id, 3]] })
    const plan = planEquipmentSwap(program, catalog, ALL, HOME)
    expect(plan.swaps.map((s) => s.to)).toEqual([DB_BENCH.id, PUSH_UP.id, DB_BENCH.id])
  })

  it('counts custom exercises that need other equipment as unmatched', () => {
    const custom = [{ id: 'c1', name: 'Sled', equipment: ['sled'], laterality: 'bilateral' as const, groups: { quads: 'primary' as const } }]
    const plan = planEquipmentSwap(programOf({ 2: [['c1', 3]] }, custom), catalog, ALL, HOME)
    expect(plan).toEqual({ swaps: [], unmatched: 1 })
  })

  it('applies every swap and keeps sets', () => {
    const program = programOf({ 0: [[BENCH.id, 4]], 3: [[MACHINE_PRESS.id, 2]] })
    const plan = planEquipmentSwap(program, catalog, ALL, HOME)
    const next = applyEquipmentSwap(program, plan.swaps)
    expect(next.days[0].entries[0]).toMatchObject({ exerciseId: DB_BENCH.id, sets: 4 })
    expect(next.days[3].entries[0]).toMatchObject({ exerciseId: PUSH_UP.id, sets: 2 })
    expect(planEquipmentSwap(next, catalog, ALL, HOME).swaps).toEqual([])
  })
})

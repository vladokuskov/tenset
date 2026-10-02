import { describe, expect, it } from 'vitest'
import {
  availableSet,
  equipment,
  equipmentGroups,
  equipmentIds,
  exercisesNeedingOther,
  groupState,
  hasEquipment,
  matchPreset,
  presetEquipment,
  presets,
} from './equipment.ts'
import type { Catalog } from './resolve.ts'
import type { Exercise, Program } from './schema.ts'

describe('equipment', () => {
  it('expands the full gym preset to every item', () => {
    expect(presetEquipment('full_gym')).toEqual(equipmentIds)
    expect(presets.map((p) => p.id)).toEqual(['full_gym', 'basic_gym', 'home_gym', 'dumbbells_bench', 'bodyweight'])
    expect(presetEquipment('nope')).toEqual([])
  })

  it('treats "*" as everything', () => {
    expect(availableSet(['*']).size).toBe(equipmentIds.length)
    expect(hasEquipment({ equipment: ['smith'] }, ['*'])).toBe(true)
    expect(hasEquipment({ equipment: ['smith'] }, new Set(['*']))).toBe(true)
  })

  it('requires every listed item', () => {
    expect(hasEquipment({ equipment: ['barbell', 'rack'] }, ['barbell'])).toBe(false)
    expect(hasEquipment({ equipment: ['barbell', 'rack'] }, new Set(['barbell', 'rack']))).toBe(true)
  })

  it('always allows bodyweight exercises', () => {
    expect(hasEquipment({ equipment: [] }, [])).toBe(true)
  })

  it('matches presets exactly', () => {
    expect(matchPreset(presetEquipment('bodyweight'))).toBe('bodyweight')
    expect(matchPreset(['*'])).toBe('full_gym')
    expect(matchPreset(['pullup_bar'])).toBeNull()
    expect(matchPreset(presetEquipment('home_gym'))).toBe('home_gym')
    expect(matchPreset([...presetEquipment('home_gym'), 'leg_press'])).toBeNull()
  })

  it('puts every item in exactly one known group', () => {
    const grouped = equipmentGroups.flatMap((g) => g.items.map((e) => e.id))
    expect(grouped.sort()).toEqual([...equipmentIds].sort())
    for (const e of equipment) expect(equipmentGroups.map((g) => g.id), e.id).toContain(e.group)
  })

  it('only uses known ids in presets', () => {
    for (const p of presets) for (const e of p.equipment) expect(equipmentIds, p.id).toContain(e)
  })

  it('reports how much of a group is selected', () => {
    const free = equipmentGroups.find((g) => g.id === 'free_weights')!
    expect(groupState(free, new Set())).toBe('none')
    expect(groupState(free, new Set(['barbell']))).toBe('some')
    expect(groupState(free, new Set(free.items.map((e) => e.id)))).toBe('all')
  })

  it('counts program exercises the selection does not cover', () => {
    const ex = (id: number, eq: string[]) => ({ id, equipment: eq }) as unknown as Exercise
    const catalog: Catalog = new Map([
      [1, ex(1, ['barbell', 'rack'])],
      [2, ex(2, [])],
      [3, ex(3, ['cable'])],
    ])
    const entry = (exerciseId: number | string) => ({ id: String(exerciseId), exerciseId, sets: 3 })
    const program = {
      days: [
        { kind: 'train', entries: [entry(1), entry(2), entry('c1')] },
        { kind: 'train', entries: [entry(1), entry(3)] },
      ],
      custom: [{ id: 'c1', name: 'Sled', equipment: ['sled'], laterality: 'bilateral', groups: {} }],
    } as unknown as Program
    expect(exercisesNeedingOther(program, catalog, ['barbell', 'rack'])).toBe(2)
    expect(exercisesNeedingOther(program, catalog, [])).toBe(3)
    expect(exercisesNeedingOther(program, catalog, ['*'])).toBe(1)
  })
})

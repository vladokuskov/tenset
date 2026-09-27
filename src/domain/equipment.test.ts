import { describe, expect, it } from 'vitest'
import { availableSet, equipmentIds, hasEquipment, matchPreset, presetEquipment, presets } from './equipment.ts'

describe('equipment', () => {
  it('expands the full gym preset to every item', () => {
    expect(presetEquipment('full_gym')).toEqual(equipmentIds)
    expect(presets.map((p) => p.id)).toEqual(['full_gym', 'dumbbells_bench', 'bodyweight'])
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
  })
})

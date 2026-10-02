import { describe, expect, it } from 'vitest'
import raw from '../../data/known-gaps.json' with { type: 'json' }
import { activeExercises } from '../data/catalog'
import { hasEquipment, presetEquipment, presets } from '../domain/equipment'
import { bandedGroupIds, getGroup, isOptional } from '../domain/taxonomy'
import { equipmentGaps, gapNote } from './knownGaps'

describe('known equipment gaps', () => {
  it('lists only banded groups for known presets', () => {
    for (const gap of raw.gaps) {
      expect(presets.map((p) => p.id)).toContain(gap.preset)
      for (const g of gap.groups) expect(getGroup(g)?.banded, g).toBe(true)
    }
  })

  it('has no gaps with a full gym or dumbbells', () => {
    expect(equipmentGaps(presetEquipment('full_gym'))).toEqual([])
    expect(equipmentGaps(presetEquipment('basic_gym'))).toEqual([])
    expect(equipmentGaps(presetEquipment('home_gym'))).toEqual([])
    expect(gapNote(presetEquipment('dumbbells_bench'))).toBeNull()
  })

  it('names what bodyweight training cannot load', () => {
    expect(equipmentGaps(presetEquipment('bodyweight'))).toEqual(['side_delt', 'rear_delt', 'upper_traps', 'forearms'])
    expect(gapNote(presetEquipment('bodyweight'))).toBe("Your equipment can't load: side delts, rear delts, upper traps, forearms.")
  })

  it('carries a preset gap over to smaller custom selections only', () => {
    expect(equipmentGaps(['step'])).toEqual(equipmentGaps(presetEquipment('bodyweight')))
    expect(equipmentGaps([])).toEqual(equipmentGaps(presetEquipment('bodyweight')))
    expect(equipmentGaps(['pullup_bar', 'step', 'dumbbell'])).toEqual([])
  })

  it('gives every preset an exercise for each required group or lists the gap', () => {
    for (const p of presets) {
      const gaps = equipmentGaps(p.equipment)
      for (const g of bandedGroupIds) {
        if (isOptional(g) || gaps.includes(g)) continue
        const has = activeExercises.some((e) => e.groups[g] && hasEquipment(e, p.equipment))
        expect(has, `${p.id}: ${g}`).toBe(true)
      }
    }
  })

  it('keeps the note neutral', () => {
    expect(gapNote(['step'])).not.toMatch(/—|risk|warning|missing|fail/i)
    expect(gapNote(['step'], 'uk')).not.toMatch(/—|оптимальн|недостатньо|підтримуюч|ризик|зарано|перетрен|відновл|бракує|не вистачає/i)
  })

  it('writes the note in Ukrainian', () => {
    expect(gapNote(presetEquipment('bodyweight'), 'uk')).toMatch(/^Ваше обладнання не навантажує: .+\.$/)
    expect(gapNote(presetEquipment('dumbbells_bench'), 'uk')).toBeNull()
  })
})

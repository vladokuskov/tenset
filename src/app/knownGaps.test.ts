import { describe, expect, it } from 'vitest'
import { activeExercises } from '../data/catalog'
import { hasEquipment, presetEquipment, presets } from '../domain/equipment'
import { bandedGroupIds, getGroup, isOptional } from '../domain/taxonomy'
import { equipmentGaps, gapNote } from './knownGaps'

describe('known equipment gaps', () => {
  it('lists only required banded groups', () => {
    for (const g of equipmentGaps([])) {
      expect(getGroup(g)?.banded, g).toBe(true)
      expect(isOptional(g), g).toBe(false)
    }
  })

  it('has no gaps with any preset', () => {
    for (const p of presets) expect(equipmentGaps(p.equipment), p.id).toEqual([])
    expect(gapNote(presetEquipment('bodyweight'))).toBeNull()
  })

  it('names what a pull-up bar and a step cannot load', () => {
    expect(equipmentGaps(['pullup_bar', 'step'])).toEqual(['rear_delt'])
    expect(gapNote(['pullup_bar', 'step'])).toBe("Your equipment can't load: rear delts.")
  })

  it('closes the gaps as equipment is added', () => {
    expect(equipmentGaps(['pullup_bar', 'step', 'band'])).toEqual([])
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
    expect(gapNote(['pullup_bar', 'step'], 'uk')).toMatch(/^Ваше обладнання не навантажує: .+\.$/)
    expect(gapNote(presetEquipment('dumbbells_bench'), 'uk')).toBeNull()
  })
})

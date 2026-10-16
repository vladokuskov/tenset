import { describe, expect, it } from 'vitest'
import { emptyMix } from '../domain/movement'
import { mixLabel, mixParts, movementLabel, mvBg, mvRing, mvVar } from './movement'

describe('movement ui helpers', () => {
  const mix = { ...emptyMix(), push: 12, pull: 11, core: 1, other: 3 }

  it('lists groups with sets in display order', () => {
    expect(mixParts(mix)).toEqual([
      { key: 'push', sets: 12 },
      { key: 'pull', sets: 11 },
      { key: 'core', sets: 1 },
      { key: 'other', sets: 3 },
    ])
  })

  it('names every group with sets and skips empty ones', () => {
    expect(mixLabel(mix, 'en')).toBe('Movement mix: Push 12 sets, Pull 11 sets, Core 1 set, Other 3 sets')
    expect(mixLabel(mix, 'uk')).toBe('Розподіл рухів: Жим 12 підходів, Тяга 11 підходів, Кор 1 підхід, Інше 3 підходи')
    expect(mixLabel(emptyMix(), 'en')).toBe('Movement mix: No sets')
  })

  it('maps groups to token classes', () => {
    expect(mvBg.legs).toBe('bg-mv-legs')
    expect(mvRing.other).toBe('ring-mv-other')
    expect(mvVar('core')).toBe('var(--color-mv-core)')
    expect(movementLabel('other', 'uk')).toBe('Інше')
  })
})

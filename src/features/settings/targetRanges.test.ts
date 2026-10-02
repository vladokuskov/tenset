import { describe, expect, it } from 'vitest'
import { customPref, modeOf, prefForMode, rangeText, targetsSummary } from './targetRanges'

describe('target ranges', () => {
  it('summarizes changed groups', () => {
    expect(targetsSummary({}, 'en')).toBe('Research ranges')
    expect(targetsSummary({ chest: { mode: 'more' }, calves: { mode: 'skip' }, serratus: { mode: 'more' } }, 'en')).toBe('2 changed')
    expect(targetsSummary({}, 'uk')).toBe('Діапазони з досліджень')
    expect(targetsSummary({ chest: { mode: 'less' } }, 'uk')).toBe('Змінено: 1')
  })

  it('describes the range a group uses now', () => {
    expect(rangeText('chest', {}, 'en')).toBe('target 10-20')
    expect(rangeText('chest', { chest: { mode: 'more' } }, 'en')).toBe('your range 15-25')
    expect(rangeText('chest', { chest: { mode: 'custom', min: 12, max: 18 } }, 'uk')).toBe('ваш діапазон 12-18')
    expect(rangeText('calves', { calves: { mode: 'skip' } }, 'en')).toBe('no range set')
  })

  it('maps a mode to the stored pref', () => {
    expect(modeOf('chest', {})).toBe('normal')
    expect(prefForMode('normal', 'chest', { chest: { mode: 'more' } })).toBeNull()
    expect(prefForMode('skip', 'chest', {})).toEqual({ mode: 'skip' })
    expect(prefForMode('custom', 'chest', {})).toEqual({ mode: 'custom', min: 10, max: 20 })
    expect(prefForMode('custom', 'chest', { chest: { mode: 'more' } })).toEqual({ mode: 'custom', min: 15, max: 25 })
    expect(prefForMode('custom', 'chest', { chest: { mode: 'skip' } })).toEqual({ mode: 'custom', min: 10, max: 20 })
    expect(prefForMode('custom', 'chest', { chest: { mode: 'custom', min: 8, max: 12 } })).toEqual({ mode: 'custom', min: 8, max: 12 })
  })

  it('keeps custom ranges whole, in bounds and with min below max', () => {
    expect(customPref(0, 100)).toEqual({ mode: 'custom', min: 1, max: 60 })
    expect(customPref(14, 14)).toEqual({ mode: 'custom', min: 14, max: 15 })
    expect(customPref(60, 60)).toEqual({ mode: 'custom', min: 59, max: 60 })
    expect(customPref(9.6, 15.2)).toEqual({ mode: 'custom', min: 10, max: 15 })
  })
})

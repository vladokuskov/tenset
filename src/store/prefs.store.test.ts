import { describe, expect, it } from 'vitest'
import { equipmentIds, presetEquipment } from '../domain/equipment.ts'
import { PREFS_KEY, createPrefsStore, defaultPrefs, localeWeekStart } from './prefs.store.ts'
import { memoryStorage } from './storage.ts'

describe('prefs store', () => {
  it('has the planned defaults', () => {
    const p = defaultPrefs('pl-PL')
    expect(p).toEqual({ goal: 'hypertrophy', equipment: [...equipmentIds], countingMode: 'fractional', weekStart: 0, overrides: {} })
  })

  it('reads week start from the locale', () => {
    expect(localeWeekStart('pl-PL')).toBe(0)
    expect(localeWeekStart('en-US')).toBe(6)
    expect(localeWeekStart('not a locale')).toBe(0)
  })

  it('sets and clears per-exercise overrides', () => {
    const store = createPrefsStore({ storage: memoryStorage(), locale: 'pl-PL' })
    const s = store.getState()
    s.setOverride(101, 'triceps', 'none')
    s.setOverride(101, 'front_delt', 'primary')
    s.setOverride('c1', 'chest', 'secondary')
    expect(store.getState().overrides).toEqual({ '101': { triceps: 'none', front_delt: 'primary' }, c1: { chest: 'secondary' } })
    s.setOverride(101, 'triceps', null)
    expect(store.getState().overrides['101']).toEqual({ front_delt: 'primary' })
    s.setOverride(101, 'front_delt', null)
    expect('101' in store.getState().overrides).toBe(false)
    s.resetOverrides('c1')
    expect(store.getState().overrides).toEqual({})
    s.setOverride(5, 'chest', 'primary')
    s.resetOverrides()
    expect(store.getState().overrides).toEqual({})
  })

  it('updates simple settings and persists them', () => {
    const storage = memoryStorage()
    const store = createPrefsStore({ storage, locale: 'pl-PL' })
    const s = store.getState()
    s.setGoal('strength')
    s.setCountingMode('primary')
    s.setWeekStart(6)
    s.setWeekStart(9)
    s.setEquipmentPreset('bodyweight')
    s.setEquipmentPreset('nope')
    const state = store.getState()
    expect(state.goal).toBe('strength')
    expect(state.countingMode).toBe('primary')
    expect(state.weekStart).toBe(6)
    expect(state.equipment).toEqual(presetEquipment('bodyweight'))
    const raw = JSON.parse(storage.getItem(PREFS_KEY)!)
    expect(raw.version).toBe(1)
    expect(raw.state.goal).toBe('strength')
    expect(Object.keys(raw.state).sort()).toEqual(['countingMode', 'equipment', 'goal', 'overrides', 'weekStart'])
  })

  it('rehydrates valid prefs and rejects corrupt ones', () => {
    const storage = memoryStorage()
    storage.setItem(PREFS_KEY, JSON.stringify({ state: { ...defaultPrefs('pl-PL'), goal: 'general' }, version: 1 }))
    expect(createPrefsStore({ storage }).getState().goal).toBe('general')

    const bad = memoryStorage()
    bad.setItem(PREFS_KEY, JSON.stringify({ state: { goal: 'bulk', weekStart: 12 }, version: 1 }))
    const store = createPrefsStore({ storage: bad, locale: 'pl-PL' })
    expect(store.getState().goal).toBe('hypertrophy')
    expect(store.getState().weekStart).toBe(0)
    expect(bad.getItem(`${PREFS_KEY}:corrupt`)).not.toBeNull()
  })

  it('resets to defaults', () => {
    const store = createPrefsStore({ storage: memoryStorage(), locale: 'pl-PL' })
    store.getState().setGoal('general')
    store.getState().reset()
    expect(store.getState().goal).toBe('hypertrophy')
  })
})

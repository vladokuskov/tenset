import { describe, expect, it } from 'vitest'
import { equipmentIds, presetEquipment } from '../domain/equipment.ts'
import { PREFS_KEY, createPrefsStore, defaultPrefs, localeWeekStart } from './prefs.store.ts'
import prefsV1 from './fixtures/prefs.v1.json'
import { listQuarantined } from './quarantine.ts'
import { memoryStorage } from './storage.ts'

describe('prefs store', () => {
  it('has the planned defaults', () => {
    const p = defaultPrefs('pl-PL')
    expect(p).toEqual({ locale: 'en', goal: 'hypertrophy', equipment: [...equipmentIds], countingMode: 'fractional', weekStart: 0, overrides: {}, targets: {} })
  })

  it('picks the language from the browser and keeps the choice', () => {
    expect(defaultPrefs('uk-UA').locale).toBe('uk')
    expect(defaultPrefs('ru-UA').locale).toBe('en')
    const storage = memoryStorage()
    const store = createPrefsStore({ storage, locale: 'en-GB' })
    store.getState().setLocale('uk')
    store.getState().reset()
    expect(store.getState().locale).toBe('uk')
    expect(createPrefsStore({ storage, locale: 'en-GB' }).getState().locale).toBe('uk')
  })

  it('fills the language for prefs saved before it existed', () => {
    const storage = memoryStorage()
    storage.setItem(
      PREFS_KEY,
      JSON.stringify({ state: { goal: 'strength', equipment: [], countingMode: 'primary', weekStart: 0, overrides: {} }, version: 1 }),
    )
    const s = createPrefsStore({ storage, locale: 'uk-UA' }).getState()
    expect(s.goal).toBe('strength')
    expect(s.locale).toBe('uk')
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
    expect(Object.keys(raw.state).sort()).toEqual(['countingMode', 'equipment', 'goal', 'locale', 'overrides', 'targets', 'weekStart'])
  })

  it('rehydrates valid prefs and falls back field by field', () => {
    const storage = memoryStorage()
    storage.setItem(PREFS_KEY, JSON.stringify({ state: { ...defaultPrefs('pl-PL'), goal: 'general' }, version: 1 }))
    expect(createPrefsStore({ storage }).getState().goal).toBe('general')

    const bad = memoryStorage()
    const overrides = { '101': { triceps: 'none' } }
    bad.setItem(PREFS_KEY, JSON.stringify({ state: { goal: 'bulk', weekStart: 12, countingMode: 'primary', overrides }, version: 1 }))
    const store = createPrefsStore({ storage: bad, locale: 'pl-PL' })
    expect(store.getState().goal).toBe('hypertrophy')
    expect(store.getState().weekStart).toBe(0)
    expect(store.getState().countingMode).toBe('primary')
    expect(store.getState().overrides).toEqual(overrides)
    expect(listQuarantined(bad).map((i) => i.data)).toEqual([{ goal: 'bulk', weekStart: 12 }])
  })

  it('hydrates the frozen v1 fixture unchanged', () => {
    const storage = memoryStorage()
    storage.setItem(PREFS_KEY, JSON.stringify(prefsV1))
    const s = createPrefsStore({ storage, locale: 'en-GB' }).getState()
    const { locale, goal, equipment, countingMode, weekStart, overrides, targets } = s
    expect({ locale, goal, equipment, countingMode, weekStart, overrides, targets }).toEqual(prefsV1.state)
    expect(listQuarantined(storage)).toEqual([])
  })

  it('resets to defaults', () => {
    const store = createPrefsStore({ storage: memoryStorage(), locale: 'pl-PL' })
    store.getState().setGoal('general')
    store.getState().reset()
    expect(store.getState().goal).toBe('hypertrophy')
  })
})

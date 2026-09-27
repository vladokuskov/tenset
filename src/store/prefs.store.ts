import { useStore } from 'zustand'
import { persist } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'
import { presetEquipment, presets } from '../domain/equipment.ts'
import { Prefs } from '../domain/schema.ts'
import { PREFS_VERSION, prefsMigrations, runMigrations } from './migrations/index.ts'
import { backupCorrupt, browserStorage, safeJSONStorage, type SyncStorage } from './storage.ts'

export const PREFS_KEY = 'gb:prefs'

type OverrideRole = 'primary' | 'secondary' | 'none'

export type PrefsActions = {
  setGoal(goal: Prefs['goal']): void
  setEquipment(equipment: readonly string[]): void
  setEquipmentPreset(presetId: string): void
  setCountingMode(mode: Prefs['countingMode']): void
  setWeekStart(day: number): void
  /** null removes the override for that group. */
  setOverride(exerciseId: number | string, group: string, role: OverrideRole | null): void
  /** Clears one exercise's overrides, or all of them. */
  resetOverrides(exerciseId?: number | string): void
  reset(): void
}

export type PrefsState = Prefs & PrefsActions

/** 0 = Monday. Intl weekInfo uses 1 = Monday .. 7 = Sunday; not every engine has it. */
export function localeWeekStart(locale?: string): number {
  try {
    const tag = locale ?? globalThis.navigator?.language
    if (!tag) return 0
    const loc = new Intl.Locale(tag) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }
      weekInfo?: { firstDay: number }
    }
    const firstDay = (loc.getWeekInfo?.() ?? loc.weekInfo)?.firstDay
    return typeof firstDay === 'number' && firstDay >= 1 && firstDay <= 7 ? firstDay - 1 : 0
  } catch {
    return 0
  }
}

export function defaultPrefs(locale?: string): Prefs {
  return {
    goal: 'hypertrophy',
    equipment: presetEquipment('full_gym'),
    countingMode: 'fractional',
    weekStart: localeWeekStart(locale),
    overrides: {},
  }
}

const pickPrefs = (s: PrefsState): Prefs => ({
  goal: s.goal,
  equipment: s.equipment,
  countingMode: s.countingMode,
  weekStart: s.weekStart,
  overrides: s.overrides,
})

export type PrefsStoreOptions = { storage?: SyncStorage; locale?: string }

export function createPrefsStore(options: PrefsStoreOptions = {}) {
  const storage = options.storage ?? browserStorage()

  return createStore<PrefsState>()(
    persist(
      (set, get) => ({
        ...defaultPrefs(options.locale),

        setGoal: (goal) => set({ goal }),
        setEquipment: (equipment) => set({ equipment: [...new Set(equipment)] }),
        setEquipmentPreset: (presetId) => {
          if (presets.some((p) => p.id === presetId)) set({ equipment: presetEquipment(presetId) })
        },
        setCountingMode: (countingMode) => set({ countingMode }),
        setWeekStart: (day) => {
          if (Number.isInteger(day) && day >= 0 && day <= 6) set({ weekStart: day })
        },
        setOverride: (exerciseId, group, role) => {
          const key = String(exerciseId)
          const { [key]: current = {}, ...others } = get().overrides
          const { [group]: _old, ...rest } = current
          const next = role === null ? rest : { ...rest, [group]: role }
          set({ overrides: Object.keys(next).length ? { ...others, [key]: next } : others })
        },
        resetOverrides: (exerciseId) => {
          if (exerciseId === undefined) return set({ overrides: {} })
          const { [String(exerciseId)]: _removed, ...rest } = get().overrides
          set({ overrides: rest })
        },
        reset: () => set(defaultPrefs(options.locale)),
      }),
      {
        name: PREFS_KEY,
        version: PREFS_VERSION,
        storage: safeJSONStorage<Prefs>(storage),
        partialize: pickPrefs,
        migrate: (state, version) => {
          try {
            return runMigrations(state, version, PREFS_VERSION, prefsMigrations) as Prefs
          } catch {
            return state as Prefs
          }
        },
        merge: (persisted, current) => {
          if (persisted === undefined || persisted === null) return current
          const parsed = Prefs.safeParse(persisted)
          if (!parsed.success) {
            backupCorrupt(storage, PREFS_KEY, JSON.stringify(persisted))
            return current
          }
          return { ...current, ...parsed.data }
        },
      },
    ),
  )
}

export const prefsStore = createPrefsStore()

export function usePrefsStore<T>(selector: (s: PrefsState) => T): T {
  return useStore(prefsStore, selector)
}

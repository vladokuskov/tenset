import { describe, expect, it } from 'vitest'
import { blankProgram } from '../domain/program.ts'
import { clearAllData } from './clear.ts'
import { PREFS_KEY, createPrefsStore } from './prefs.store.ts'
import { PROGRAMS_KEY, createProgramStore } from './program.store.ts'
import { quarantine } from './quarantine.ts'
import { memoryStorage } from './storage.ts'

function keyedStorage() {
  const map = new Map<string, string>()
  return {
    ...memoryStorage(),
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
    keys: () => [...map.keys()],
  }
}

describe('clearAllData', () => {
  it('removes every app key and empties both stores, leaving other keys alone', () => {
    const storage = keyedStorage()
    storage.setItem(PROGRAMS_KEY, JSON.stringify({ state: { programs: { a: blankProgram('a', 'A') }, activeId: 'a' }, version: 1 }))
    storage.setItem('other-site-key', 'x')
    storage.setItem('gb:ui:catalog-grid', '1')
    quarantine(storage, PROGRAMS_KEY, { programs: { b: {} } })
    const programs = createProgramStore({ storage })
    const prefs = createPrefsStore({ storage, locale: 'pl-PL' })
    prefs.getState().setGoal('strength')
    expect(programs.getState().programs.a).toBeDefined()

    clearAllData(storage, programs, prefs)
    expect(storage.keys()).toEqual(['other-site-key'])
    expect(programs.getState().programs).toEqual({})
    expect(prefs.getState().goal).toBe('hypertrophy')
    expect(storage.getItem(PREFS_KEY)).toBeNull()
  })
})

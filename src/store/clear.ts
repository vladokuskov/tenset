import { storageHealth } from './health.ts'

type KeyedStorage = Pick<Storage, 'key' | 'length' | 'removeItem'>

/** Every key this app writes starts with this. */
export const APP_KEY_PREFIX = 'gb:'

type Resettable = { setState: (s: { programs: Record<string, never>; activeId: null; lastChange: null }) => void }

/** Empties both stores and removes every app key from this device, quarantined data included. */
export function clearAllData(storage: KeyedStorage, programs: Resettable, prefs: { getState: () => { reset: () => void } }): void {
  programs.setState({ programs: {}, activeId: null, lastChange: null })
  prefs.getState().reset()
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key?.startsWith(APP_KEY_PREFIX)) keys.push(key)
  }
  for (const key of keys) storage.removeItem(key)
  storageHealth.setState({ quarantined: [] })
}

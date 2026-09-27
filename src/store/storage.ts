import type { PersistStorage } from 'zustand/middleware'

export type SyncStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function memoryStorage(): SyncStorage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

/** localStorage when usable (it can be missing or throw in private modes), else in-memory. */
export function browserStorage(): SyncStorage {
  try {
    const s = globalThis.localStorage
    if (s) {
      s.getItem('gb:probe')
      return s
    }
  } catch {
    // fall through
  }
  return memoryStorage()
}

export function backupCorrupt(storage: SyncStorage, name: string, raw: string): void {
  try {
    storage.setItem(`${name}:corrupt`, raw)
  } catch {
    // best effort
  }
}

/** JSON persist storage that never throws; unreadable values are backed up under `<name>:corrupt` and treated as absent. */
export function safeJSONStorage<S>(storage: SyncStorage): PersistStorage<S> {
  return {
    getItem(name) {
      let raw: string | null
      try {
        raw = storage.getItem(name)
      } catch {
        return null
      }
      if (raw === null) return null
      try {
        const value = JSON.parse(raw)
        if (value && typeof value === 'object' && 'state' in value) return value
      } catch {
        // corrupt JSON
      }
      backupCorrupt(storage, name, raw)
      return null
    },
    setItem(name, value) {
      try {
        storage.setItem(name, JSON.stringify(value))
      } catch {
        // quota or blocked storage: keep working in memory
      }
    },
    removeItem(name) {
      try {
        storage.removeItem(name)
      } catch {
        // ignore
      }
    },
  }
}

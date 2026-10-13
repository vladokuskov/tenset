import { PREFS_KEY } from './prefs.store.ts'
import { PROGRAMS_KEY } from './program.store.ts'

type Rehydratable = { persist: { rehydrate: () => unknown } }

/**
 * Reloads a store when another tab writes its key (a null key means storage was cleared there),
 * so this tab's next save does not overwrite the other tab's changes. Rehydrating the programs store
 * also drops its undo snapshot, which predates the other tab's change. Returns the cleanup.
 */
export function syncAcrossTabs(target: Pick<Window, 'addEventListener' | 'removeEventListener'>, programs: Rehydratable, prefs: Rehydratable) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === PROGRAMS_KEY) void programs.persist.rehydrate()
    if (e.key === null || e.key === PREFS_KEY) void prefs.persist.rehydrate()
  }
  target.addEventListener('storage', onStorage)
  return () => target.removeEventListener('storage', onStorage)
}

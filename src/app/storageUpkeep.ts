import { useEffect } from 'react'
import { requestPersistentStorage } from '../store/persist'
import { prefsStore } from '../store/prefs.store'
import { programStore } from '../store/program.store'
import { syncAcrossTabs } from '../store/sync'

/** Cross-tab sync, and a persistent storage request after the first change. */
export function useStorageUpkeep(): void {
  useEffect(() => syncAcrossTabs(window, programStore, prefsStore), [])

  useEffect(() => {
    const unsubscribe = programStore.subscribe((s) => {
      if (!s.lastChange) return
      unsubscribe()
      void requestPersistentStorage()
    })
    return unsubscribe
  }, [])
}

import { useEffect } from 'react'
import { getMessages } from '../../i18n/messages'
import { storageHealth, type StorageHealth } from '../../store/health'
import { requestPersistentStorage } from '../../store/persist'
import { prefsStore } from '../../store/prefs.store'
import { programStore } from '../../store/program.store'
import { syncAcrossTabs } from '../../store/sync'
import { showToast } from '../../ui/toast'
import { downloadBackup, downloadSetAside } from './backupFile'
import { exportMessages } from './messages'

/**
 * App-wide storage upkeep with no UI of its own: cross-tab sync, a persistent storage request after
 * the first change, and one toast per session when data was set aside or is not being saved.
 */
export function StorageNotices() {
  useEffect(() => syncAcrossTabs(window, programStore, prefsStore), [])

  useEffect(() => {
    const unsubscribe = programStore.subscribe((s) => {
      if (!s.lastChange) return
      unsubscribe()
      void requestPersistentStorage()
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const shown = new Set<keyof StorageHealth>()
    const notify = (h: StorageHealth) => {
      const m = getMessages(exportMessages).storage
      if (h.quarantined.length && !shown.has('quarantined')) {
        shown.add('quarantined')
        showToast({ message: m.setAside, action: { label: m.download, onAction: downloadSetAside }, duration: 10000 })
      }
      for (const kind of ['memoryOnly', 'writeFailed'] as const) {
        if (!h[kind] || shown.has(kind)) continue
        shown.add(kind)
        showToast({ message: m[kind], action: { label: m.downloadBackup, onAction: downloadBackup }, duration: 10000 })
      }
    }
    notify(storageHealth.getState())
    return storageHealth.subscribe(notify)
  }, [])

  return null
}

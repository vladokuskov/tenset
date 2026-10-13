import { useEffect } from 'react'
import { getMessages } from '../../i18n/messages'
import { storageHealth, type StorageHealth } from '../../store/health'
import { showToast } from '../../ui/toast'
import { downloadBackup, downloadSetAside } from './backupFile'
import { exportMessages } from './messages'

/** One toast per session when data was set aside or is not being saved, with a download to keep a copy. */
export function StorageNotices() {
  useEffect(() => {
    const shown = new Set<keyof StorageHealth>()
    const notify = (h: StorageHealth) => {
      const m = getMessages(exportMessages).storage
      if (h.quarantined.length && !shown.has('quarantined')) {
        shown.add('quarantined')
        showToast({ message: m.setAside, action: { label: m.download, onAction: downloadSetAside }, duration: 10000, important: true })
      }
      for (const kind of ['memoryOnly', 'writeFailed'] as const) {
        if (!h[kind] || shown.has(kind)) continue
        shown.add(kind)
        showToast({ message: m[kind], action: { label: m.downloadBackup, onAction: downloadBackup }, duration: 10000, important: true })
      }
      if (h.newerVersion && !shown.has('newerVersion')) {
        shown.add('newerVersion')
        showToast({ message: m.newerVersion, action: { label: m.reload, onAction: () => window.location.reload() }, duration: 10000, important: true })
      }
    }
    notify(storageHealth.getState())
    return storageHealth.subscribe(notify)
  }, [])

  return null
}

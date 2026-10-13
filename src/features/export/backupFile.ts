import { prefsStore } from '../../store/prefs.store'
import { programStore } from '../../store/program.store'
import { listQuarantined, serializeQuarantined } from '../../store/quarantine'
import { browserStorage } from '../../store/storage'
import { backupFileName, createBackup, serializeBackup } from './backup'
import { download } from './files'
import { recordExport } from './lastExport'

export function makeBackupFile(): File {
  const { programs, activeId } = programStore.getState()
  const text = serializeBackup(createBackup({ programs, activeId }, prefsStore.getState()))
  return new File([text], backupFileName(), { type: 'application/json' })
}

export function downloadBackup(): void {
  download(makeBackupFile())
  recordExport()
}

export function hasSetAside(): boolean {
  return listQuarantined(browserStorage()).length > 0
}

/** Everything kept aside after failed validation, as one JSON file. */
export function downloadSetAside(): void {
  const text = serializeQuarantined(listQuarantined(browserStorage()))
  download(new File([text], backupFileName().replace('tenset-', 'tenset-set-aside-'), { type: 'application/json' }))
}

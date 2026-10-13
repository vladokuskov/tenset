import { Download, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useStore } from 'zustand'
import { dateFormat } from '../../i18n/format'
import { getMessages, useLocale, useMessages } from '../../i18n/messages'
import { clearAllData } from '../../store/clear'
import { storageHealth } from '../../store/health'
import { forgetExport, useLastExport } from '../../store/lastExport'
import { prefsStore } from '../../store/prefs.store'
import { programStore, useProgramStore } from '../../store/program.store'
import { Button, Panel, Section } from '../../ui'
import { showToast } from '../../ui/toast'
import { downloadBackup, downloadSetAside, hasSetAside } from '../export'
import { settingsMessages } from './messages'
import { SettingRow } from './SettingRow'

/** Backup, data that was set aside after failed validation, and deleting everything on this device. */
export function DataSection() {
  const m = useMessages(settingsMessages)
  const locale = useLocale()
  const count = useProgramStore((s) => Object.keys(s.programs).length)
  const lastExport = useLastExport()
  // Read once per render: quarantine only changes on hydrate or delete-all, both reflected in health.
  useStore(storageHealth, (s) => s.quarantined.length)
  const setAside = hasSetAside()
  const [confirming, setConfirming] = useState(false)

  const deleteAll = () => {
    try {
      clearAllData(localStorage, programStore, prefsStore)
    } catch {
      programStore.setState({ programs: {}, activeId: null, lastChange: null })
      prefsStore.getState().reset()
    }
    forgetExport()
    setConfirming(false)
    showToast({ message: getMessages(settingsMessages).deletedAll })
  }

  return (
    <Section title={m.group.data}>
      <Panel className="divide-y divide-line">
        <SettingRow
          label={m.backup}
          hint={
            lastExport && !Number.isNaN(Date.parse(lastExport))
              ? m.lastExported(dateFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(lastExport)))
              : m.neverExported
          }
        >
          <Button variant="secondary" size="sm" icon={Download} disabled={count === 0} onClick={downloadBackup} className="md:ml-auto">
            {m.exportBackup}
          </Button>
        </SettingRow>
        {setAside && (
          <SettingRow label={m.setAside} hint={m.setAsideHint}>
            <Button variant="secondary" size="sm" icon={Download} onClick={downloadSetAside} className="md:ml-auto">
              {m.download}
            </Button>
          </SettingRow>
        )}
        <div>
          <SettingRow label={m.deleteAll} hint={m.deleteAllHint}>
            <Button
              variant="secondary"
              size="sm"
              icon={Trash2}
              aria-expanded={confirming}
              onClick={() => setConfirming(true)}
              className="md:ml-auto"
            >
              {m.deleteAllButton}
            </Button>
          </SettingRow>
          {confirming && (
            <div role="group" aria-label={m.deleteAll} className="px-4 pb-4">
              <p className="text-sm text-ink-2">{m.deleteAllConfirm}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" icon={Trash2} onClick={deleteAll}>
                  {m.deleteAllButton}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  {m.cancel}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Panel>
    </Section>
  )
}

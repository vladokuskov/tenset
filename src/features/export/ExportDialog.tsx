import { ClipboardPaste, Download, FileUp, Printer, Share } from 'lucide-react'
import { useRef, useState } from 'react'
import { dateFormat } from '../../i18n/format'
import { getMessages, useLocale, useMessages } from '../../i18n/messages'
import { prefsStore, usePrefsStore } from '../../store/prefs.store'
import { programStore, useProgramStore } from '../../store/program.store'
import { Button } from '../../ui/Button'
import { LinkButton } from '../../ui/links'
import { Sheet } from '../../ui/Sheet'
import { showToast } from '../../ui/toast'
import { parseBackup, withUniqueNames, type ParsedBackup } from './backup'
import { downloadBackup, makeBackupFile } from './backupFile'
import { canShareFiles } from './files'
import { recordExport } from './lastExport'
import { exportMessages } from './messages'

export type ExportDialogProps = {
  open: boolean
  onClose: () => void
  /** Opens the paste sheet in place of this one. */
  onPaste?: () => void
}

type Pending = { name: string; backup: ParsedBackup; activeId: string | null }

/** Backup file of all programs and settings, and import that only ever adds programs. */
export function ExportDialog({ open, onClose, onPaste }: ExportDialogProps) {
  const count = useProgramStore((s) => Object.keys(s.programs).length)
  const importProgram = useProgramStore((s) => s.importProgram)
  const setActive = useProgramStore((s) => s.setActive)
  const overrides = usePrefsStore((s) => Object.keys(s.overrides).length)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [usePrefs, setUsePrefs] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const m = useMessages(exportMessages)
  const locale = useLocale()

  const reset = () => {
    setPending(null)
    setError(null)
    setUsePrefs(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const close = () => {
    reset()
    onClose()
  }

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    const res = parseBackup(await file.text())
    if (!res.ok) {
      setPending(null)
      setError(getMessages(exportMessages).errors[res.error])
      return
    }
    setPending({ name: file.name, backup: res.backup, activeId: res.activeId })
    setUsePrefs(count === 0 && res.backup.prefs !== null)
  }

  const runImport = () => {
    if (!pending) return
    const { activeId: before, programs } = programStore.getState()
    const named = withUniqueNames(pending.backup.programs, Object.values(programs).map((p) => p.name))
    const added = named.map((p) => ({ from: p.id, id: importProgram(p) }))
    const ids = added.map((a) => a.id).filter((id): id is string => id !== null)
    // Keep the program the user was on; a restore onto an empty device reopens the backup's active one.
    const restored = added.find((a) => a.from === pending.activeId)?.id ?? ids[0]
    const next = before ?? restored
    if (next) setActive(next)
    programStore.getState().clearUndo()
    if (usePrefs && pending.backup.prefs)
      prefsStore.setState({ ...pending.backup.prefs, locale: pending.backup.prefs.locale ?? prefsStore.getState().locale })
    showToast({ message: getMessages(exportMessages).imported(ids.length, usePrefs) })
    close()
  }

  const shareFile = async () => {
    try {
      await navigator.share({ files: [makeBackupFile()], title: getMessages(exportMessages).shareTitle })
      recordExport()
    } catch {
      // cancelled
    }
  }

  return (
    <Sheet open={open} onClose={close} title={m.title} desktop="center">
      <section>
        <h3 className="font-semibold">{m.backUp}</h3>
        <p className="mt-1 text-sm text-ink-2">
          {m.backupText(count, overrides)}
        </p>
        <div className="mt-3 flex gap-3">
          <Button variant="primary" className="flex-1" icon={Download} disabled={count === 0} onClick={downloadBackup}>
            {m.download}
          </Button>
          {canShareFiles() && (
            <Button variant="secondary" className="flex-1" icon={Share} disabled={count === 0} onClick={() => void shareFile()}>
              {m.shareFile}
            </Button>
          )}
        </div>
      </section>

      <section className="mt-6 border-t border-line pt-5">
        <h3 className="font-semibold">{m.importHeading}</h3>
        <p className="mt-1 text-sm text-ink-2">{m.importText}</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        {!pending && (
          <Button variant="secondary" className="mt-3 w-full" icon={FileUp} onClick={() => inputRef.current?.click()}>
            {m.choose}
          </Button>
        )}
        {error && (
          <p role="status" className="mt-3 text-sm text-ink">
            {error}
          </p>
        )}
        {pending && (
          <div className="mt-3 rounded-lg bg-surface-2 p-4">
            <p className="truncate font-medium">{pending.name}</p>
            <p className="mt-0.5 text-sm text-ink-2">
              {m.pendingSummary(
                pending.backup.programs.length,
                Number.isNaN(Date.parse(pending.backup.exportedAt))
                  ? null
                  : dateFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(pending.backup.exportedAt)),
              )}
            </p>
            {pending.backup.skipped > 0 && (
              <p className="mt-1 text-sm text-ink-2">
                {m.skipped(pending.backup.skipped)}
              </p>
            )}
            {pending.backup.prefs && (
              <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={usePrefs}
                  onChange={(e) => setUsePrefs(e.target.checked)}
                  className="size-5 accent-[var(--color-ink)]"
                />
                {m.alsoSettings}
              </label>
            )}
            <div className="mt-3 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={reset}>
                {m.cancel}
              </Button>
              <Button variant="primary" className="flex-1" disabled={!pending.backup.programs.length && !usePrefs} onClick={runImport}>
                {m.importButton}
              </Button>
            </div>
          </div>
        )}
      </section>

      {onPaste && (
        <section className="mt-6 border-t border-line pt-5">
          <h3 className="font-semibold">{m.paste.heading}</h3>
          <p className="mt-1 text-sm text-ink-2">{m.paste.text}</p>
          <Button variant="secondary" className="mt-3 w-full" icon={ClipboardPaste} onClick={onPaste}>
            {m.paste.open}
          </Button>
        </section>
      )}

      <section className="mt-6 border-t border-line pt-5">
        <h3 className="font-semibold">{m.printHeading}</h3>
        <p className="mt-1 text-sm text-ink-2">{m.printText}</p>
        <LinkButton to="/print" variant="secondary" className="mt-3 w-full" icon={Printer}>
          {m.openPrint}
        </LinkButton>
      </section>
    </Sheet>
  )
}

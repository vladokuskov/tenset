import { Download, FileUp, Printer, Share } from 'lucide-react'
import { useRef, useState } from 'react'
import { countLabel } from '../../app/format'
import { prefsStore, usePrefsStore } from '../../store/prefs.store'
import { programStore, useProgramStore } from '../../store/program.store'
import { Button } from '../../ui/Button'
import { LinkButton } from '../../ui/links'
import { Sheet } from '../../ui/Sheet'
import { showToast } from '../../ui/toast'
import { backupFileName, createBackup, parseBackup, serializeBackup, withUniqueNames, type BackupError, type ParsedBackup } from './backup'

export type ExportDialogProps = { open: boolean; onClose: () => void }

const ERRORS: Record<BackupError, string> = {
  too_large: 'This file is too large to be a Gym Builder backup.',
  not_json: 'This file is not a Gym Builder backup.',
  wrong_file: 'This file is not a Gym Builder backup.',
  newer_version: 'This backup comes from a newer version of the app. Reload to update, then try again.',
  invalid: 'This backup could not be read. It may be damaged or edited.',
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

function makeFile(): File {
  const { programs, activeId } = programStore.getState()
  const text = serializeBackup(createBackup({ programs, activeId }, prefsStore.getState()))
  return new File([text], backupFileName(), { type: 'application/json' })
}

function download(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type Pending = { name: string; backup: ParsedBackup; activeId: string | null }

let shareFilesSupport: boolean | undefined
function canShareFiles(): boolean {
  if (shareFilesSupport === undefined) {
    try {
      shareFilesSupport =
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [new File(['{}'], 'test.json', { type: 'application/json' })] })
    } catch {
      shareFilesSupport = false
    }
  }
  return shareFilesSupport
}

/** Backup file of all programs and settings, and import that only ever adds programs. */
export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const count = useProgramStore((s) => Object.keys(s.programs).length)
  const importProgram = useProgramStore((s) => s.importProgram)
  const setActive = useProgramStore((s) => s.setActive)
  const overrides = usePrefsStore((s) => Object.keys(s.overrides).length)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [usePrefs, setUsePrefs] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      setError(ERRORS[res.error])
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
    if (usePrefs && pending.backup.prefs) prefsStore.setState(pending.backup.prefs)
    const parts = [ids.length ? `Added ${countLabel(ids.length, 'program')}` : null, usePrefs ? 'settings updated' : null]
    showToast({ message: parts.filter(Boolean).join(', ') || 'Nothing to import' })
    close()
  }

  const shareFile = async () => {
    try {
      await navigator.share({ files: [makeFile()], title: 'Gym Builder backup' })
    } catch {
      // cancelled
    }
  }

  return (
    <Sheet open={open} onClose={close} title="Export or import" desktop="center">
      <section>
        <h3 className="font-semibold">Back up</h3>
        <p className="mt-1 text-sm text-ink-2">
          One file with {countLabel(count, 'program')} and your settings
          {overrides ? `, including ${countLabel(overrides, 'custom mapping')}` : ''}. Keep it somewhere safe: this app
          stores everything on this device only.
        </p>
        <div className="mt-3 flex gap-3">
          <Button variant="primary" className="flex-1" icon={Download} disabled={count === 0} onClick={() => download(makeFile())}>
            Download backup
          </Button>
          {canShareFiles() && (
            <Button variant="secondary" className="flex-1" icon={Share} disabled={count === 0} onClick={() => void shareFile()}>
              Share file
            </Button>
          )}
        </div>
      </section>

      <section className="mt-6 border-t border-line pt-5">
        <h3 className="font-semibold">Import</h3>
        <p className="mt-1 text-sm text-ink-2">Programs in the file are added as new programs. Nothing you have is overwritten.</p>
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
            Choose backup file
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
              {countLabel(pending.backup.programs.length, 'program')}
              {Number.isNaN(Date.parse(pending.backup.exportedAt)) ? '' : `, saved ${dateFormat.format(new Date(pending.backup.exportedAt))}`}
            </p>
            {pending.backup.skipped > 0 && (
              <p className="mt-1 text-sm text-ink-2">
                {countLabel(pending.backup.skipped, 'program')} could not be read and will be skipped.
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
                Also use the settings from this file (goal, equipment, counting, week start, custom mappings)
              </label>
            )}
            <div className="mt-3 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={reset}>
                Cancel
              </Button>
              <Button variant="primary" className="flex-1" disabled={!pending.backup.programs.length && !usePrefs} onClick={runImport}>
                Import
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="mt-6 border-t border-line pt-5">
        <h3 className="font-semibold">Print</h3>
        <p className="mt-1 text-sm text-ink-2">A one-page week table with the body map, for paper or PDF.</p>
        <LinkButton to="/print" variant="secondary" className="mt-3 w-full" icon={Printer}>
          Open print view
        </LinkButton>
      </section>
    </Sheet>
  )
}

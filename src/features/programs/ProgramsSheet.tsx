import { Check, Copy, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { joinMeta } from '../../app/format'
import { gapNote } from '../../app/knownGaps'
import { toastWithUndo } from '../../app/undo'
import { useCatalog } from '../../app/useCatalog'
import { NAME_MAX } from '../../domain/program'
import type { Program } from '../../domain/schema'
import { common } from '../../i18n/common'
import { compareText } from '../../i18n/format'
import type { Locale } from '../../i18n/locale'
import { getMessages, useLocale, useMessages } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { useProgramStore } from '../../store/program.store'
import { Button, IconButton, Sheet, showToast, cx } from '../../ui'
import { ChangeBar } from '../builder/ChangeBar'
import { carryUndo, undoLastChange, useChange } from '../builder/useChange'
import { programsMessages } from './messages'

function programMeta(p: Program, locale: Locale): string {
  const train = p.days.filter((d) => d.kind === 'train')
  const sets = train.reduce((s, d) => s + d.entries.reduce((a, e) => a + e.sets, 0), 0)
  return joinMeta([common[locale].trainingDays(train.length), common[locale].sets(sets)])
}

/** Program switcher: pick the active program, create, rename, duplicate, delete (with Undo). */
export function ProgramsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const programs = useProgramStore((s) => s.programs)
  const activeId = useProgramStore((s) => s.activeId)
  const store = useProgramStore((s) => s)
  const equipment = usePrefsStore((s) => s.equipment)
  const m = useMessages(programsMessages)
  const locale = useLocale()
  const undone = common[locale].undone
  const gaps = gapNote(equipment, locale)
  const { splits, catalog } = useCatalog()
  const change = useChange()
  const [menu, setMenu] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setMenu(null)
      setConfirming(null)
      setRenaming(null)
      setStatus(null)
    }
  }

  const list = Object.values(programs).sort((a, b) => compareText(locale, a.name, b.name))
  const run = (message: string, action: () => void) => {
    const res = change(message, action, { toast: false })
    if (res) setStatus(res.message)
    setMenu(null)
    setConfirming(null)
  }

  const createBlank = () => {
    onClose()
    change(m.createdBlank, () => store.createBlank())
  }

  const createFromTemplate = (id: string) => {
    const template = splits.find((s) => s.id === id)
    if (!template) return
    onClose()
    let dropped = 0
    const res = change(m.created(template.name), () => {
      dropped = store.createFromTemplate(template, template.defaultDays, equipment, catalog).notes.filter((n) => n.kind === 'dropped_slot').length
    }, { toast: false })
    if (res) toastWithUndo(dropped ? getMessages(programsMessages).createdDropped(res.message, dropped) : res.message)
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        carryUndo(status)
        onClose()
      }}
      title={m.title}
      description={m.onDevice(list.length)}
      footer={status ? <ChangeBar message={status} onUndo={status !== undone ? () => undoLastChange() && setStatus(undone) : undefined} /> : undefined}
    >
      <ul className="divide-y divide-line">
        {list.map((p) => {
          const active = p.id === activeId
          return (
            <li key={p.id} className="py-1">
              {renaming === p.id ? (
                <form
                  className="flex items-center gap-2 py-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (name.trim() && name.trim() !== p.name) run(m.renamed(name.trim()), () => store.renameProgram(p.id, name))
                    setRenaming(null)
                  }}
                >
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">{m.programName}</span>
                    <input
                      value={name}
                      maxLength={NAME_MAX}
                      onChange={(e) => setName(e.target.value)}
                      className="h-11 w-full rounded-md bg-surface-2 px-3 text-base"
                    />
                  </label>
                  <Button type="submit" variant="primary" size="sm">
                    {m.save}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                    {m.cancel}
                  </Button>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => {
                      if (!active) {
                        store.setActive(p.id)
                        showToast({ message: getMessages(programsMessages).switched(p.name) })
                      }
                      onClose()
                    }}
                    className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-md text-left"
                  >
                    <span
                      className={cx(
                        'flex size-6 shrink-0 items-center justify-center rounded-full border',
                        active ? 'border-ink bg-ink text-on-ink' : 'border-line-strong',
                      )}
                      aria-hidden
                    >
                      {active && <Check size={14} strokeWidth={2.5} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-base font-medium">{p.name}</span>
                      <span className="num block truncate text-sm text-ink-2">{programMeta(p, locale)}</span>
                    </span>
                  </button>
                  <IconButton
                    icon={Ellipsis}
                    size={36}
                    label={m.options(p.name)}
                    aria-expanded={menu === p.id}
                    onClick={() => {
                      setMenu(menu === p.id ? null : p.id)
                      setConfirming(null)
                    }}
                  />
                </div>
              )}
              {menu === p.id && renaming !== p.id && confirming === p.id && (
                <div className="pb-3 pl-9">
                  <p className="text-sm text-ink-2">{m.deleteConfirm(p.name)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" icon={Trash2} onClick={() => run(m.deleted(p.name), () => store.deleteProgram(p.id))}>
                      {m.delete}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      {m.cancel}
                    </Button>
                  </div>
                </div>
              )}
              {menu === p.id && renaming !== p.id && confirming !== p.id && (
                <div className="flex flex-wrap gap-2 pb-3 pl-9">
                  <Button
                    size="sm"
                    icon={Pencil}
                    onClick={() => {
                      setName(p.name)
                      setRenaming(p.id)
                      setMenu(null)
                    }}
                  >
                    {m.rename}
                  </Button>
                  <Button size="sm" icon={Copy} onClick={() => run(m.duplicated(p.name), () => store.duplicateProgram(p.id))}>
                    {m.duplicate}
                  </Button>
                  <Button size="sm" icon={Trash2} onClick={() => setConfirming(p.id)}>
                    {m.delete}
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <h3 className="mt-6 text-sm font-semibold">{m.newProgram}</h3>
      <p className="mt-0.5 text-sm text-ink-2">{m.neverReplace}</p>
      {gaps && <p className="mt-1 text-sm text-ink-2">{gaps}</p>}
      <Button className="mt-3" icon={Plus} onClick={createBlank}>
        {m.blank}
      </Button>
      <ul className="mt-3 divide-y divide-line rounded-lg bg-surface">
        {splits.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => createFromTemplate(s.id)}
              className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-base">{s.name}</span>
                <span className="block text-sm text-ink-2">{m.daysAWeek(s.daysPerWeek)}</span>
              </span>
              <Plus size={18} className="shrink-0 text-ink-3" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

import { Check, Copy, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { countLabel, joinMeta, setsLabel } from '../../app/format'
import { toastWithUndo } from '../../app/undo'
import { useCatalog } from '../../app/useCatalog'
import { NAME_MAX } from '../../domain/program'
import type { Program } from '../../domain/schema'
import { usePrefsStore } from '../../store/prefs.store'
import { useProgramStore } from '../../store/program.store'
import { Button, IconButton, Sheet, showToast, cx } from '../../ui'
import { ChangeBar } from '../builder/ChangeBar'
import { undoLastChange, useChange } from '../builder/useChange'

function programMeta(p: Program): string {
  const train = p.days.filter((d) => d.kind === 'train')
  const sets = train.reduce((s, d) => s + d.entries.reduce((a, e) => a + e.sets, 0), 0)
  return joinMeta([countLabel(train.length, 'training day'), setsLabel(sets)])
}

/** Program switcher: pick the active program, create, rename, duplicate, delete (with Undo). */
export function ProgramsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const programs = useProgramStore((s) => s.programs)
  const activeId = useProgramStore((s) => s.activeId)
  const store = useProgramStore((s) => s)
  const equipment = usePrefsStore((s) => s.equipment)
  const { splits, catalog } = useCatalog()
  const change = useChange()
  const [menu, setMenu] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setMenu(null)
      setRenaming(null)
      setStatus(null)
    }
  }

  const list = Object.values(programs).sort((a, b) => a.name.localeCompare(b.name))
  const run = (message: string, action: () => void) => {
    const res = change(message, action, { toast: false })
    if (res) setStatus(res.message)
    setMenu(null)
  }

  const createBlank = () => {
    onClose()
    change('Created a blank program', () => store.createBlank())
  }

  const createFromTemplate = (id: string) => {
    const template = splits.find((s) => s.id === id)
    if (!template) return
    onClose()
    let dropped = 0
    const res = change(`Created ${template.name}`, () => {
      dropped = store.createFromTemplate(template, template.defaultDays, equipment, catalog).notes.filter((n) => n.kind === 'dropped_slot').length
    }, { toast: false })
    if (res) toastWithUndo(dropped ? `${res.message} · ${countLabel(dropped, 'slot')} left out for your equipment` : res.message)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Programs"
      description={`${countLabel(list.length, 'program')} on this device`}
      footer={status ? <ChangeBar message={status} onUndo={status !== 'Undone' ? () => undoLastChange() && setStatus('Undone') : undefined} /> : undefined}
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
                    if (name.trim() && name.trim() !== p.name) run(`Renamed to ${name.trim()}`, () => store.renameProgram(p.id, name))
                    setRenaming(null)
                  }}
                >
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Program name</span>
                    <input
                      value={name}
                      maxLength={NAME_MAX}
                      onChange={(e) => setName(e.target.value)}
                      className="h-11 w-full rounded-md bg-surface-2 px-3 text-base"
                    />
                  </label>
                  <Button type="submit" variant="primary" size="sm">
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                    Cancel
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
                        showToast({ message: `Switched to ${p.name}` })
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
                      <span className="num block truncate text-sm text-ink-2">{programMeta(p)}</span>
                    </span>
                  </button>
                  <IconButton
                    icon={Ellipsis}
                    size={36}
                    label={`Options for ${p.name}`}
                    aria-expanded={menu === p.id}
                    onClick={() => setMenu(menu === p.id ? null : p.id)}
                  />
                </div>
              )}
              {menu === p.id && renaming !== p.id && (
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
                    Rename
                  </Button>
                  <Button size="sm" icon={Copy} onClick={() => run(`Duplicated ${p.name}`, () => store.duplicateProgram(p.id))}>
                    Duplicate
                  </Button>
                  <Button size="sm" icon={Trash2} onClick={() => run(`Deleted ${p.name}`, () => store.deleteProgram(p.id))}>
                    Delete
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <h3 className="mt-6 text-sm font-semibold">New program</h3>
      <p className="mt-0.5 text-sm text-ink-2">New programs never replace an existing one.</p>
      <Button className="mt-3" icon={Plus} onClick={createBlank}>
        Blank program
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
                <span className="block text-sm text-ink-2">{s.daysPerWeek} days a week</span>
              </span>
              <Plus size={18} className="shrink-0 text-ink-3" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

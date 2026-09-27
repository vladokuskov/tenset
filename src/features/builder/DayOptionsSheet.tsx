import { BedDouble, Dumbbell, Eraser } from 'lucide-react'
import { useState } from 'react'
import { dayName, type DayIndex } from '../../app/days'
import { useWeek } from '../../app/useWeek'
import { LABEL_MAX, NOTE_MAX } from '../../domain/program'
import { programStore, useProgramStore } from '../../store/program.store'
import { Button, ChipGroup, Sheet } from '../../ui'
import { ChangeBar } from './ChangeBar'
import { undoLastChange, useChange } from './useChange'

const field = 'w-full rounded-md bg-surface-2 px-3 text-base text-ink placeholder:text-ink-3'

export function DayOptionsSheet({ day, open, onClose }: { day: DayIndex; open: boolean; onClose: () => void }) {
  const view = useWeek()
  const store = useProgramStore((s) => s)
  const change = useChange()
  const d = view?.program.days[day]
  const [label, setLabel] = useState(d?.label ?? '')
  const [note, setNote] = useState(d?.note ?? '')
  const [target, setTarget] = useState<DayIndex | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setLabel(d?.label ?? '')
      setNote(d?.note ?? '')
      setTarget(null)
      setStatus(null)
    }
  }
  if (!view || !d) return <Sheet open={false} onClose={onClose} title="Day" />

  const name = dayName(day, 'long')
  const run = (message: string, action: () => void) => {
    const res = change(message, action, { toast: false })
    if (res) setStatus(res.message)
  }
  const saveLabel = () => {
    if (label.trim() !== (d.label ?? '')) run(label.trim() ? `${name} is now "${label.trim()}"` : 'Label removed', () => store.setLabel(day, label))
  }
  const saveNote = () => {
    if (note.trim() !== (d.note ?? '')) run(note.trim() ? 'Note saved' : 'Note removed', () => store.setNote(day, note))
  }
  const undo = () => {
    if (!undoLastChange()) return
    setStatus('Undone')
    const { programs, activeId } = programStore.getState()
    const restored = activeId ? programs[activeId]?.days[day] : undefined
    setLabel(restored?.label ?? '')
    setNote(restored?.note ?? '')
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        saveLabel()
        saveNote()
        onClose()
      }}
      title={name}
      description="Day options"
      footer={<ChangeBar message={status} onUndo={status && status !== 'Undone' ? undo : undefined} />}
    >
      <label className="block">
        <span className="text-sm font-semibold">Label</span>
        <input
          value={label}
          maxLength={LABEL_MAX}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={saveLabel}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), e.preventDefault())}
          placeholder="e.g. Push, Legs, Upper A"
          className={`${field} mt-1.5 h-11`}
        />
      </label>

      <label className="mt-4 block">
        <span className="text-sm font-semibold">Note</span>
        <textarea
          value={note}
          maxLength={NOTE_MAX}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveNote}
          placeholder="e.g. Warm up the shoulders first"
          className={`${field} mt-1.5 resize-none py-2.5`}
        />
        <span className="mt-1 flex justify-between text-xs text-ink-3">
          <span>Notes never count toward sets.</span>
          <span className="num">
            {note.length}/{NOTE_MAX}
          </span>
        </span>
      </label>

      <div className="mt-5">
        <h3 className="text-sm font-semibold">Duplicate to</h3>
        <p className="mt-0.5 text-sm text-ink-2">Replaces everything on the day you pick.</p>
        <ChipGroup
          label="Duplicate to"
          className="mt-2"
          size="sm"
          allowEmpty
          options={view.order.filter((x) => x !== day).map((x) => ({ value: x, label: dayName(x) }))}
          value={target}
          onChange={setTarget}
        />
        <Button
          className="mt-3"
          disabled={target === null}
          onClick={() => {
            if (target === null) return
            run(`Duplicated ${name} to ${dayName(target, 'long')}`, () => store.duplicateDay(day, target))
            setTarget(null)
          }}
        >
          Duplicate {name}
        </Button>
      </div>

      <ul className="-mx-2 mt-5 border-t border-line pt-2">
        <li>
          <button
            type="button"
            className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left text-base hover:bg-surface-2"
            onClick={() =>
              d.kind === 'rest'
                ? run(`${name} is a training day`, () => store.setTrain(day))
                : run(`${name} is a rest day`, () => store.setRest(day))
            }
          >
            {d.kind === 'rest' ? (
              <Dumbbell size={20} strokeWidth={1.75} className="text-ink-2" aria-hidden />
            ) : (
              <BedDouble size={20} strokeWidth={1.75} className="text-ink-2" aria-hidden />
            )}
            {d.kind === 'rest' ? 'Make it a training day' : 'Make it a rest day'}
          </button>
        </li>
        <li>
          <button
            type="button"
            disabled={d.entries.length === 0}
            className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left text-base hover:bg-surface-2 disabled:opacity-45"
            onClick={() => run(`Cleared ${name}`, () => store.clearDay(day))}
          >
            <Eraser size={20} strokeWidth={1.75} className="text-ink-2" aria-hidden />
            Clear all exercises
          </button>
        </li>
      </ul>
    </Sheet>
  )
}

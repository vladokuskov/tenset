import { BedDouble, Dumbbell, Eraser, ImageDown } from 'lucide-react'
import { useState } from 'react'
import { dayName, type DayIndex } from '../../app/days'
import { useWeek } from '../../app/useWeek'
import { sessionLabel } from '../../data/localize'
import { LABEL_MAX, NOTE_MAX } from '../../domain/program'
import { common } from '../../i18n/common'
import { useLocale } from '../../i18n/messages'
import { programStore, useProgramStore } from '../../store/program.store'
import { Button, ChipGroup, Sheet } from '../../ui'
import { ChangeBar } from './ChangeBar'
import { builderMessages } from './messages'
import { carryUndo, undoLastChange, useChange } from './useChange'

const field = 'w-full rounded-md bg-surface-2 px-3 text-base text-ink placeholder:text-ink-3'

export function DayOptionsSheet({
  day,
  open,
  onClose,
  onImage,
}: {
  day: DayIndex
  open: boolean
  onClose: () => void
  /** Opens the image sheet in place of this one. */
  onImage?: () => void
}) {
  const view = useWeek()
  const store = useProgramStore((s) => s)
  const change = useChange()
  const locale = useLocale()
  const m = builderMessages[locale]
  const c = common[locale]
  const d = view?.program.days[day]
  const [label, setLabel] = useState(sessionLabel(d?.label, locale) ?? '')
  const [note, setNote] = useState(d?.note ?? '')
  const [target, setTarget] = useState<DayIndex | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setLabel(sessionLabel(d?.label, locale) ?? '')
      setNote(d?.note ?? '')
      setTarget(null)
      setStatus(null)
    }
  }
  if (!view || !d) return <Sheet open={false} onClose={onClose} title={m.day} />

  const name = dayName(day, 'long', locale)
  const run = (message: string, action: () => void) => {
    const res = change(message, action, { toast: false })
    if (res) setStatus(res.message)
    return res?.message ?? null
  }
  const saveLabel = () => {
    if (label.trim() !== (sessionLabel(d.label, locale) ?? '')) return run(label.trim() ? m.labelNow(day, label.trim()) : m.labelRemoved, () => store.setLabel(day, label))
    return null
  }
  const saveNote = () => {
    if (note.trim() !== (d.note ?? '')) return run(note.trim() ? m.noteSaved : m.noteRemoved, () => store.setNote(day, note))
    return null
  }
  // Typed label and note are saved before leaving, by close or by switching to another sheet.
  const saveAll = () => {
    const labelChange = saveLabel()
    const noteChange = saveNote()
    carryUndo(noteChange ?? labelChange ?? status)
  }
  const undo = () => {
    if (!undoLastChange()) return
    setStatus(c.undone)
    const { programs, activeId } = programStore.getState()
    const restored = activeId ? programs[activeId]?.days[day] : undefined
    setLabel(sessionLabel(restored?.label, locale) ?? '')
    setNote(restored?.note ?? '')
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        saveAll()
        onClose()
      }}
      title={name}
      description={m.dayOptions}
      footer={<ChangeBar message={status} onUndo={status && status !== c.undone ? undo : undefined} />}
    >
      <label className="block">
        <span className="text-sm font-semibold">{m.label}</span>
        <input
          value={label}
          maxLength={LABEL_MAX}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={saveLabel}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), e.preventDefault())}
          placeholder={m.labelPlaceholder}
          className={`${field} mt-1.5 h-11`}
        />
      </label>

      <label className="mt-4 block">
        <span className="text-sm font-semibold">{m.note}</span>
        <textarea
          value={note}
          maxLength={NOTE_MAX}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveNote}
          placeholder={m.notePlaceholder}
          className={`${field} mt-1.5 resize-none py-2.5`}
        />
        <span className="mt-1 flex justify-between text-xs text-ink-3">
          <span>{m.noteHint}</span>
          <span className="num">
            {note.length}/{NOTE_MAX}
          </span>
        </span>
      </label>

      <div className="mt-5">
        <h3 className="text-sm font-semibold">{m.duplicateTo}</h3>
        <p className="mt-0.5 text-sm text-ink-2">{m.duplicateHint}</p>
        <ChipGroup
          label={m.duplicateTo}
          className="mt-2"
          size="sm"
          allowEmpty
          options={view.order.filter((x) => x !== day).map((x) => ({ value: x, label: dayName(x, 'short', locale) }))}
          value={target}
          onChange={setTarget}
        />
        <Button
          className="mt-3"
          disabled={target === null}
          onClick={() => {
            if (target === null) return
            run(m.duplicated(day, target), () => store.duplicateDay(day, target))
            setTarget(null)
          }}
        >
          {m.duplicate(day)}
        </Button>
      </div>

      <ul className="-mx-2 mt-5 border-t border-line pt-2">
        <li>
          <button
            type="button"
            className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left text-base hover:bg-surface-2"
            onClick={() =>
              d.kind === 'rest'
                ? run(m.isTrainingDay(day), () => store.setTrain(day))
                : run(m.isRestDay(day), () => store.setRest(day))
            }
          >
            {d.kind === 'rest' ? (
              <Dumbbell size={20} strokeWidth={1.75} className="text-ink-2" aria-hidden />
            ) : (
              <BedDouble size={20} strokeWidth={1.75} className="text-ink-2" aria-hidden />
            )}
            {d.kind === 'rest' ? m.makeTraining : m.makeRest}
          </button>
        </li>
        <li>
          <button
            type="button"
            disabled={d.entries.length === 0}
            className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left text-base hover:bg-surface-2 disabled:opacity-45"
            onClick={() => run(m.cleared(day), () => store.clearDay(day))}
          >
            <Eraser size={20} strokeWidth={1.75} className="text-ink-2" aria-hidden />
            {m.clearAll}
          </button>
        </li>
        {onImage && (
          <li>
            <button
              type="button"
              className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left text-base hover:bg-surface-2"
              onClick={() => {
                saveAll()
                onImage()
              }}
            >
              <ImageDown size={20} strokeWidth={1.75} className="text-ink-2" aria-hidden />
              {m.saveImage}
            </button>
          </li>
        )}
      </ul>
    </Sheet>
  )
}

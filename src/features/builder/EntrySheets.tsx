import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowLeftRight, ArrowUp, CalendarArrowUp, ChevronRight, Copy, Info, Trash2, type LucideIcon } from 'lucide-react'
import { useRef, useState, type ReactNode, type Ref } from 'react'
import { dayName, type DayIndex } from '../../app/days'
import { formatDaySummary, joinMeta } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import { useWeek } from '../../app/useWeek'
import { availableSet } from '../../domain/equipment'
import { resolveExercise } from '../../domain/resolve'
import type { Entry } from '../../domain/schema'
import { common } from '../../i18n/common'
import { useLocale } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { useProgramStore } from '../../store/program.store'
import { Button, Chip, Sheet, Stepper, cx, useSheet } from '../../ui'
import { rankAlternatives } from '../catalog'
import { ChangeBar } from '../shared/ChangeBar'
import { defaultReps, isCustom, repsText, unitOf, type AnyExercise } from '../shared/exercise'
import { exerciseFor, findEntry } from '../shared/lookup'
import { sharedMessages } from '../shared/messages'
import { carryUndo, undoLastChange, useChange } from '../shared/useChange'
import { EntryNoteField } from './EntryNoteField'
import { RestPicker, RirPicker, SupersetToggle } from './EntryTargets'
import { builderMessages } from './messages'
import { PickRow } from './PickRow'
import { REPS_PRESETS, SECONDS_PRESETS } from './presets'

const rowClass = 'flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left text-base hover:bg-surface-2'

type ActionRowProps = { icon: LucideIcon; label: string; onClick: () => void; tone?: 'plain'; disabled?: boolean; ref?: Ref<HTMLButtonElement> }

function ActionRow({ icon: Icon, label, onClick, tone, disabled, ref }: ActionRowProps) {
  return (
    <li>
      <button ref={ref} type="button" disabled={disabled} onClick={onClick} className={cx(rowClass, 'disabled:opacity-45 disabled:hover:bg-transparent')}>
        <Icon size={20} strokeWidth={1.75} className={cx('shrink-0', tone ? 'text-ink' : 'text-ink-2')} aria-hidden />
        <span className="flex-1">{label}</span>
      </button>
    </li>
  )
}

/** Hosts the entry menu, the reps sheet and the menu's follow-up sheets (swap, move, copy) for the day screen. */
export function EntrySheets() {
  const entrySheet = useSheet('entry', ['entry'])
  const swapSheet = useSheet('swap', ['entry'])
  const moveSheet = useSheet('move', ['entry'])
  const copySheet = useSheet('copy', ['entry'])
  const repsSheet = useSheet('reps', ['entry'])
  const view = useWeek()
  const { catalog } = useCatalog()
  const entryId = typeof entrySheet.search.entry === 'string' ? entrySheet.search.entry : undefined
  const found = findEntry(view?.program, entryId)
  const exercise = found ? exerciseFor(found.entry.exerciseId, catalog, view?.program) : null

  // Keep the last entry around while a sheet animates out after removal.
  const [last, setLast] = useState<{ found: NonNullable<typeof found>; exercise: AnyExercise } | null>(null)
  if (found && exercise && (last?.found.entry !== found.entry || last.exercise !== exercise)) setLast({ found, exercise })
  const shown = found && exercise ? { found, exercise } : last

  return (
    <>
      <EntryMenu
        open={entrySheet.open && Boolean(found)}
        onClose={entrySheet.close}
        data={shown}
        onSwitch={(name) => entrySheet.switchTo(name, { entry: entryId })}
      />
      <RepsSheet open={repsSheet.open && Boolean(found)} onClose={repsSheet.close} data={shown} />
      <SwapSheet open={swapSheet.open && Boolean(found)} onClose={swapSheet.close} data={shown} />
      <DayTargetSheet mode="move" open={moveSheet.open && Boolean(found)} onClose={moveSheet.close} data={shown} />
      <DayTargetSheet mode="copy" open={copySheet.open && Boolean(found)} onClose={copySheet.close} data={shown} />
    </>
  )
}

type EntryData = { found: { day: number; index: number; entry: Entry }; exercise: AnyExercise } | null

function EntryMenu({ open, onClose, data, onSwitch }: { open: boolean; onClose: () => void; data: EntryData; onSwitch: (name: string) => void }) {
  const setSets = useProgramStore((s) => s.setSets)
  const removeEntry = useProgramStore((s) => s.removeEntry)
  const reorder = useProgramStore((s) => s.reorder)
  const setEntryNote = useProgramStore((s) => s.setEntryNote)
  const view = useWeek()
  const upRef = useRef<HTMLButtonElement>(null)
  const downRef = useRef<HTMLButtonElement>(null)
  const change = useChange()
  const locale = useLocale()
  const m = builderMessages[locale]
  const sm = sharedMessages[locale]
  const c = common[locale]
  const [status, setStatus] = useState<string | null>(null)
  const savedNote = data?.found.entry.note ?? ''
  const [note, setNote] = useState(savedNote)
  const [shownNote, setShownNote] = useState(savedNote)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setStatus(null)
  }
  // Follows the stored note when it changes underneath (opening another entry, Undo).
  if (savedNote !== shownNote) {
    setShownNote(savedNote)
    setNote(savedNote)
  }
  if (!data) return <Sheet open={false} onClose={onClose} title={m.exercise} />

  const { entry, day, index } = data.found
  const ex = data.exercise
  const run = (message: string, action: () => void, noteSplit?: boolean) => {
    const res = change(message, action, { toast: false, noteSplit })
    if (res) setStatus(res.message)
    return res?.message ?? null
  }
  const saveNote = () => {
    if (note.trim() === savedNote) return null
    return run(note.trim() ? m.noteSaved : m.noteRemoved, () => setEntryNote(entry.id, note))
  }
  // A typed note is saved before leaving. On close its Undo moves to a toast, also when blur saved it first.
  const close = () => {
    const saved = saveNote() ?? (status === m.noteSaved || status === m.noteRemoved ? status : null)
    onClose()
    carryUndo(saved)
  }
  const switchTo = (name: string) => {
    saveNote()
    onSwitch(name)
  }
  const unit = unitOf(ex)
  const count = view?.program.days[day]?.entries.length ?? 0
  const move = (to: number) => {
    run(m.movedToPosition(ex.name, to + 1), () => reorder(day, index, to), true)
    // The pressed button is disabled at either end, so focus moves to the other one.
    if (to === 0) downRef.current?.focus()
    if (to === count - 1) upRef.current?.focus()
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={ex.name}
      description={joinMeta([dayName(day, 'long', locale), c.sets(entry.sets), entry.reps && repsText(entry.reps, unit, locale)])}
      footer={<ChangeBar message={status} onUndo={status && status !== c.undone ? () => undoLastChange() && setStatus(c.undone) : undefined} />}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{m.hardSets}</h3>
        <Stepper
          value={entry.sets}
          onChange={(v) => run(sm.setsChanged(ex.name, v), () => setSets(entry.id, v))}
          label={sm.setsFor(ex.name)}
          unit={m.setsUnit}
          decrementLabel={m.fewerSets}
          incrementLabel={m.moreSets}
        />
      </div>

      <RepsPicker key={String(open)} entry={entry} exercise={ex} onChange={run} className="mt-5" />
      <RestPicker key={`rest-${open}`} entry={entry} exercise={ex} onChange={run} className="mt-5" />
      <RirPicker entry={entry} onChange={run} className="mt-5" />
      <SupersetToggle entry={entry} index={data.found.index} day={day} exercise={ex} onChange={run} className="-mx-2 mt-4" />
      <EntryNoteField value={note} name={ex.name} onChange={setNote} onSave={saveNote} className="mt-4" />

      <ul className="-mx-2 mt-5 border-t border-line pt-2">
        {count > 1 && (
          <>
            <ActionRow ref={upRef} icon={ArrowUp} label={m.moveUp} disabled={index === 0} onClick={() => move(index - 1)} />
            <ActionRow ref={downRef} icon={ArrowDown} label={m.moveDown} disabled={index >= count - 1} onClick={() => move(index + 1)} />
          </>
        )}
        <ActionRow icon={ArrowLeftRight} label={m.swapSimilar} onClick={() => switchTo('swap')} />
        <ActionRow icon={CalendarArrowUp} label={m.moveOther} onClick={() => switchTo('move')} />
        <ActionRow icon={Copy} label={m.copyOther} onClick={() => switchTo('copy')} />
        {!isCustom(ex) && (
          <li>
            <Link to="/exercise/$slug" params={{ slug: ex.slug }} className={rowClass} onClick={() => saveNote()}>
              <Info size={20} strokeWidth={1.75} className="shrink-0 text-ink-2" aria-hidden />
              <span className="flex-1">{m.exerciseDetails}</span>
              <ChevronRight size={18} className="text-ink-3" aria-hidden />
            </Link>
          </li>
        )}
        <ActionRow
          icon={Trash2}
          tone="plain"
          label={m.removeFromDay}
          onClick={() => {
            onClose()
            change(m.removed(ex.name), () => removeEntry(entry.id))
          }}
        />
      </ul>
    </Sheet>
  )
}

/** Reps chips: the exercise's suggested range first, then presets, then a custom field. */
function RepsPicker({
  entry,
  exercise,
  onChange,
  className,
}: {
  entry: Entry
  exercise: AnyExercise
  onChange: (message: string, action: () => void) => void
  className?: string
}) {
  const setReps = useProgramStore((s) => s.setReps)
  const goal = usePrefsStore((s) => s.goal)
  const locale = useLocale()
  const m = builderMessages[locale]
  const c = common[locale]
  const [customOpen, setCustomOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const unit = unitOf(exercise)
  const suggested = defaultReps(exercise, goal)
  const all: readonly string[] = unit === 'seconds' ? SECONDS_PRESETS : REPS_PRESETS
  const presets = all.filter((p) => p !== suggested)
  const isKnown = !entry.reps || entry.reps === suggested || presets.includes(entry.reps)
  const title = unit === 'seconds' ? m.secondsPerSet : m.repsPerSet

  const apply = (reps: string | undefined) => {
    const next = reps === suggested ? undefined : reps
    if ((next ?? '') === (entry.reps ?? '')) return
    onChange(next ? m.repsSetTo(repsText(next, unit, locale)) : m.repsCleared, () => setReps(entry.id, next))
  }

  const saveCustom = () => {
    const clean = draft.trim().slice(0, 16)
    if (clean) apply(clean)
    setCustomOpen(false)
  }

  return (
    <div className={className}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <div role="group" aria-label={title} className="mt-2 flex flex-wrap gap-2">
        {suggested && (
          <Chip selected={!entry.reps || entry.reps === suggested} onClick={() => apply(undefined)}>
            {m.suggestedReps(suggested)}
          </Chip>
        )}
        {presets.map((p) => (
          <Chip key={p} selected={entry.reps === p} onClick={() => apply(entry.reps === p ? undefined : p)}>
            {p}
          </Chip>
        ))}
        {!isKnown && !customOpen && (
          <Chip selected onClick={() => apply(undefined)}>
            {entry.reps}
          </Chip>
        )}
        <Chip
          selected={customOpen}
          onClick={() => {
            setDraft(isKnown ? '' : (entry.reps ?? ''))
            setCustomOpen(!customOpen)
          }}
        >
          {m.custom}
        </Chip>
      </div>
      {customOpen && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            saveCustom()
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">{unit === 'seconds' ? m.customSeconds : m.customReps}</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={16}
              placeholder={unit === 'seconds' ? m.secondsPlaceholder : m.repsPlaceholder}
              inputMode="text"
              className="h-11 w-full rounded-md bg-surface-2 px-3 text-base placeholder:text-ink-3"
            />
          </label>
          <Button type="submit" variant="primary">
            {c.save}
          </Button>
        </form>
      )}
    </div>
  )
}

/** Reps only, opened from the reps chip on an entry row. */
function RepsSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: EntryData }) {
  const change = useChange()
  const locale = useLocale()
  const m = builderMessages[locale]
  const c = common[locale]
  const [status, setStatus] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setStatus(null)
  }
  if (!data) return <Sheet open={false} onClose={onClose} title={m.repsPerSet} />
  const { entry, day } = data.found
  const run = (message: string, action: () => void) => {
    const res = change(message, action, { toast: false })
    if (res) setStatus(res.message)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={data.exercise.name}
      description={joinMeta([dayName(day, 'long', locale), c.sets(entry.sets)])}
      desktop="center"
      footer={<ChangeBar message={status} onUndo={status && status !== c.undone ? () => undoLastChange() && setStatus(c.undone) : undefined} />}
    >
      <RepsPicker key={String(open)} entry={entry} exercise={data.exercise} onChange={run} />
    </Sheet>
  )
}

function SwapSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: EntryData }) {
  const { activeExercises, catalog } = useCatalog()
  const view = useWeek()
  const equipment = usePrefsStore((s) => s.equipment)
  const countingMode = usePrefsStore((s) => s.countingMode)
  const overrides = usePrefsStore((s) => s.overrides)
  const swapEntry = useProgramStore((s) => s.swapEntry)
  const change = useChange()
  const locale = useLocale()
  const m = builderMessages[locale]
  const [all, setAll] = useState(false)

  if (!data) return <Sheet open={false} onClose={onClose} title={m.swap} />
  const ex = data.exercise
  const ctx = { catalog, custom: view?.program.custom ?? [], countingMode, overrides }
  const primaries = (e: AnyExercise) =>
    Object.entries(resolveExercise(e.id, ctx)?.groups ?? {})
      .filter(([, g]) => g.role === 'primary')
      .map(([g]) => g)
  const mine = primaries(ex)
  const avail = availableSet(equipment)
  const candidates = activeExercises.filter((e) => {
    if (e.id === ex.id) return false
    if (!isCustom(ex)) return e.pattern === ex.pattern
    return primaries(e).some((g) => mine.includes(g))
  })
  const ranked = rankAlternatives(ex, candidates, ctx, avail)
  const fitting = ranked.filter((r) => r.available)
  const list = (all ? ranked : fitting).map((r) => r.exercise)
  const hidden = candidates.length - fitting.length

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={m.swapNamed(ex.name)}
      description={isCustom(ex) ? m.sameMuscles : m.samePattern}
    >
      {list.length === 0 ? (
        <p className="py-6 text-center text-base text-ink-2">{m.noSwap}</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((e) => (
            <li key={e.id}>
              <PickRow
                exercise={e}
                trailing={
                  <Button
                    size="sm"
                    onClick={() => {
                      onClose()
                      change(m.swappedTo(e.name), () => swapEntry(data.found.entry.id, e.id))
                    }}
                  >
                    {m.swap}
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <div className="mt-4 flex justify-center">
          <Button variant="link" size="sm" onClick={() => setAll(!all)}>
            {all ? m.onlyMine : m.showOtherEquipment(hidden)}
          </Button>
        </div>
      )}
    </Sheet>
  )
}

function DayTargetSheet({ mode, open, onClose, data }: { mode: 'move' | 'copy'; open: boolean; onClose: () => void; data: EntryData }) {
  const view = useWeek()
  const moveEntry = useProgramStore((s) => s.moveEntry)
  const copyEntry = useProgramStore((s) => s.copyEntry)
  const change = useChange()
  const locale = useLocale()
  const m = builderMessages[locale]
  if (!data || !view) return <Sheet open={false} onClose={onClose} title={mode === 'move' ? m.move : m.copy} />
  const { day, entry } = data.found

  const pick = (d: DayIndex) => {
    onClose()
    if (mode === 'move') change(m.movedTo(data.exercise.name, d), () => moveEntry(entry.id, d), { noteSplit: true })
    else change(m.copiedTo(data.exercise.name, d), () => copyEntry(entry.id, d))
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === 'move' ? m.moveNamed(data.exercise.name) : m.copyNamed(data.exercise.name)}
      description={mode === 'move' ? m.pickMove : m.pickCopy}
      desktop="center"
    >
      <ul className="-mx-2">
        {view.order.map((d) => {
          const s = view.days[d]
          const current = d === day
          return (
            <li key={d}>
              <DayPickRow
                disabled={current}
                onClick={() => pick(d)}
                title={dayName(d, 'long', locale)}
                meta={
                  current
                    ? m.thisDay
                    : s.kind === 'rest'
                      ? m.restBecomesTraining
                      : joinMeta([s.label, formatDaySummary(s.exercises, s.hardSets, locale, s.estMinutes)])
                }
              />
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}

function DayPickRow({ title, meta, onClick, disabled }: { title: string; meta: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-surface-2 disabled:opacity-45 disabled:hover:bg-transparent"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium">{title}</span>
        <span className="num block truncate text-sm text-ink-2">{meta}</span>
      </span>
      {!disabled && <ChevronRight size={18} className="shrink-0 text-ink-3" aria-hidden />}
    </button>
  )
}

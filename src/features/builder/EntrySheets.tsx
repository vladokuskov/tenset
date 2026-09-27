import { Link } from '@tanstack/react-router'
import { ArrowLeftRight, CalendarArrowUp, ChevronRight, Copy, Info, Trash2, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { dayName, type DayIndex } from '../../app/days'
import { formatDaySummary, joinMeta, plural } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import { useWeek } from '../../app/useWeek'
import { availableSet, hasEquipment } from '../../domain/equipment'
import { resolveExercise } from '../../domain/resolve'
import { usePrefsStore } from '../../store/prefs.store'
import { useProgramStore } from '../../store/program.store'
import { Button, Chip, Sheet, Stepper, cx, useSheet } from '../../ui'
import { ChangeBar } from './ChangeBar'
import { REPS_PRESETS, SECONDS_PRESETS, isCustom, repsText, unitOf, type AnyExercise } from './labels'
import { exerciseFor, findEntry } from './lookup'
import { PickRow } from './PickRow'
import { undoLastChange, useChange } from './useChange'

const rowClass = 'flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left text-base hover:bg-surface-2'

function ActionRow({ icon: Icon, label, onClick, tone }: { icon: LucideIcon; label: string; onClick: () => void; tone?: 'plain' }) {
  return (
    <li>
      <button type="button" onClick={onClick} className={rowClass}>
        <Icon size={20} strokeWidth={1.75} className={cx('shrink-0', tone ? 'text-ink' : 'text-ink-2')} aria-hidden />
        <span className="flex-1">{label}</span>
      </button>
    </li>
  )
}

/** Hosts the entry menu and its follow-up sheets (swap, move, copy) for the day screen. */
export function EntrySheets() {
  const entrySheet = useSheet('entry', ['entry'])
  const swapSheet = useSheet('swap', ['entry'])
  const moveSheet = useSheet('move', ['entry'])
  const copySheet = useSheet('copy', ['entry'])
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
      <SwapSheet open={swapSheet.open && Boolean(found)} onClose={swapSheet.close} data={shown} />
      <DayTargetSheet mode="move" open={moveSheet.open && Boolean(found)} onClose={moveSheet.close} data={shown} />
      <DayTargetSheet mode="copy" open={copySheet.open && Boolean(found)} onClose={copySheet.close} data={shown} />
    </>
  )
}

type EntryData = { found: { day: number; index: number; entry: import('../../domain/schema').Entry }; exercise: AnyExercise } | null

function EntryMenu({ open, onClose, data, onSwitch }: { open: boolean; onClose: () => void; data: EntryData; onSwitch: (name: string) => void }) {
  const setSets = useProgramStore((s) => s.setSets)
  const setReps = useProgramStore((s) => s.setReps)
  const removeEntry = useProgramStore((s) => s.removeEntry)
  const change = useChange()
  const [status, setStatus] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStatus(null)
      setCustomOpen(false)
    }
  }
  if (!data) return <Sheet open={false} onClose={onClose} title="Exercise" />

  const { entry, day } = data.found
  const ex = data.exercise
  const unit = unitOf(ex)
  const presets: readonly string[] = unit === 'seconds' ? SECONDS_PRESETS : REPS_PRESETS
  const isPreset = entry.reps ? presets.includes(entry.reps) : false

  const run = (message: string, action: () => void) => {
    const res = change(message, action, { toast: false })
    if (res) setStatus(res.message)
  }

  const applyReps = (reps: string | undefined) => {
    if ((reps ?? '') === (entry.reps ?? '')) return
    run(reps ? `Reps set to ${repsText(reps, unit)}` : 'Reps cleared', () => setReps(entry.id, reps))
  }

  const saveCustom = () => {
    const clean = draft.trim().slice(0, 16)
    if (clean) applyReps(clean)
    setCustomOpen(false)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={ex.name}
      description={joinMeta([dayName(day, 'long'), `${entry.sets} ${plural(entry.sets, 'set')}`, entry.reps && repsText(entry.reps, unit)])}
      footer={<ChangeBar message={status} onUndo={status && status !== 'Undone' ? () => undoLastChange() && setStatus('Undone') : undefined} />}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Hard sets</h3>
        <Stepper
          value={entry.sets}
          onChange={(v) => run(`${ex.name}: ${v} ${plural(v, 'set')}`, () => setSets(entry.id, v))}
          label={`Sets for ${ex.name}`}
          unit="sets"
          decrementLabel="Fewer sets"
          incrementLabel="More sets"
        />
      </div>

      <h3 className="mt-5 text-sm font-semibold">{unit === 'seconds' ? 'Seconds per set' : 'Reps per set'}</h3>
      <div role="group" aria-label={unit === 'seconds' ? 'Seconds per set' : 'Reps per set'} className="mt-2 flex flex-wrap gap-2">
        {presets.map((p) => (
          <Chip key={p} selected={entry.reps === p} onClick={() => applyReps(entry.reps === p ? undefined : p)}>
            {p}
          </Chip>
        ))}
        {entry.reps && !isPreset && !customOpen && (
          <Chip selected onClick={() => applyReps(undefined)}>
            {entry.reps}
          </Chip>
        )}
        <Chip
          selected={customOpen}
          onClick={() => {
            setDraft(entry.reps && !isPreset ? entry.reps : '')
            setCustomOpen(!customOpen)
          }}
        >
          Custom
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
            <span className="sr-only">Custom {unit === 'seconds' ? 'seconds' : 'reps'}</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={16}
              placeholder={unit === 'seconds' ? 'e.g. 40' : 'e.g. 12-20 or 5'}
              inputMode="text"
              className="h-11 w-full rounded-md bg-surface-2 px-3 text-base placeholder:text-ink-3"
            />
          </label>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </form>
      )}

      <ul className="-mx-2 mt-5 border-t border-line pt-2">
        <ActionRow icon={ArrowLeftRight} label="Swap for a similar exercise" onClick={() => onSwitch('swap')} />
        <ActionRow icon={CalendarArrowUp} label="Move to another day" onClick={() => onSwitch('move')} />
        <ActionRow icon={Copy} label="Copy to another day" onClick={() => onSwitch('copy')} />
        {!isCustom(ex) && (
          <li>
            <Link to="/exercise/$slug" params={{ slug: ex.slug }} className={rowClass}>
              <Info size={20} strokeWidth={1.75} className="shrink-0 text-ink-2" aria-hidden />
              <span className="flex-1">Exercise details</span>
              <ChevronRight size={18} className="text-ink-3" aria-hidden />
            </Link>
          </li>
        )}
        <ActionRow
          icon={Trash2}
          tone="plain"
          label="Remove from this day"
          onClick={() => {
            onClose()
            change(`Removed ${ex.name}`, () => removeEntry(entry.id))
          }}
        />
      </ul>
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
  const [all, setAll] = useState(false)

  if (!data) return <Sheet open={false} onClose={onClose} title="Swap" />
  const ex = data.exercise
  const ctx = { catalog, custom: view?.program.custom ?? [], countingMode, overrides }
  const primaries = (e: AnyExercise) =>
    Object.entries(resolveExercise(e.id, ctx)?.groups ?? {})
      .filter(([, g]) => g.role === 'primary')
      .map(([g]) => g)
  const mine = primaries(ex)
  const avail = availableSet(equipment)
  const alternatives = isCustom(ex) ? [] : ex.alternatives
  const candidates = activeExercises.filter((e) => {
    if (e.id === ex.id) return false
    if (!isCustom(ex)) return e.pattern === ex.pattern
    return primaries(e).some((g) => mine.includes(g))
  })
  const fitting = candidates.filter((e) => hasEquipment(e, avail))
  const list = (all ? candidates : fitting).sort((a, b) => {
    const ra = alternatives.indexOf(a.id)
    const rb = alternatives.indexOf(b.id)
    const shared = (e: AnyExercise) => primaries(e).filter((g) => mine.includes(g)).length
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || shared(b) - shared(a) || a.name.localeCompare(b.name)
  })
  const hidden = candidates.length - fitting.length

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Swap ${ex.name}`}
      description={isCustom(ex) ? 'Exercises that train the same main muscles' : 'Same movement pattern'}
    >
      {list.length === 0 ? (
        <p className="py-6 text-center text-base text-ink-2">No other exercise with this pattern fits your equipment.</p>
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
                      change(`Swapped to ${e.name}`, () => swapEntry(data.found.entry.id, e.id))
                    }}
                  >
                    Swap
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
            {all ? 'Only my equipment' : `Show ${hidden} that need other equipment`}
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
  if (!data || !view) return <Sheet open={false} onClose={onClose} title={mode === 'move' ? 'Move' : 'Copy'} />
  const { day, entry } = data.found

  const pick = (d: DayIndex) => {
    onClose()
    if (mode === 'move') change(`Moved ${data.exercise.name} to ${dayName(d, 'long')}`, () => moveEntry(entry.id, d))
    else change(`Copied ${data.exercise.name} to ${dayName(d, 'long')}`, () => copyEntry(entry.id, d))
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === 'move' ? `Move ${data.exercise.name}` : `Copy ${data.exercise.name}`}
      description={mode === 'move' ? 'Pick the day it moves to.' : 'Pick the day that gets a copy.'}
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
                title={dayName(d, 'long')}
                meta={
                  current
                    ? 'This day'
                    : s.kind === 'rest'
                      ? 'Rest, becomes a training day'
                      : joinMeta([s.label, formatDaySummary(s.exercises, s.hardSets)])
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

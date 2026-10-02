import { useId, useState } from 'react'
import { formatRest } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import { canLinkWithPrev, clampRest, REST_MAX, REST_STEP, RIR_MAX } from '../../domain/program'
import type { Entry } from '../../domain/schema'
import { defaultRestSec } from '../../domain/session'
import { common } from '../../i18n/common'
import { useLocale } from '../../i18n/messages'
import { useActiveProgram, useProgramStore } from '../../store/program.store'
import { Button, Chip, ChipGroup, cx } from '../../ui'
import { isCustom, type AnyExercise } from './labels'
import { exerciseFor } from './lookup'
import { builderMessages } from './messages'

type Run = (message: string, action: () => void) => void

const REST_PRESETS = [60, 90, 120, 180] as const

const restDefaultFor = (e: AnyExercise) => defaultRestSec({ mechanic: isCustom(e) ? null : e.mechanic })

/** Rest chips: the exercise default first, then presets, then a custom field in seconds. */
export function RestPicker({ entry, exercise, onChange, className }: { entry: Entry; exercise: AnyExercise; onChange: Run; className?: string }) {
  const setRestSec = useProgramStore((s) => s.setRestSec)
  const locale = useLocale()
  const m = builderMessages[locale]
  const c = common[locale]
  const [customOpen, setCustomOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const fallback = restDefaultFor(exercise)
  const presets = REST_PRESETS.filter((p) => p !== fallback)
  const current = entry.restSec
  const isKnown = current === undefined || current === fallback || (presets as readonly number[]).includes(current)

  const apply = (sec: number | undefined) => {
    const next = sec === undefined || clampRest(sec) === fallback ? undefined : clampRest(sec)
    if (next === current) return
    onChange(next === undefined ? m.restCleared : m.restSetTo(formatRest(next, locale)), () => setRestSec(entry.id, next))
  }

  const saveCustom = () => {
    const n = Number(draft.trim())
    if (draft.trim() && Number.isFinite(n)) apply(n)
    setCustomOpen(false)
  }

  return (
    <div className={className}>
      <h3 className="text-sm font-semibold">{m.restTitle}</h3>
      <div role="group" aria-label={m.restTitle} className="mt-2 flex flex-wrap gap-2">
        <Chip selected={current === undefined || current === fallback} onClick={() => apply(undefined)}>
          {m.restDefault(formatRest(fallback, locale))}
        </Chip>
        {presets.map((p) => (
          <Chip key={p} selected={current === p} onClick={() => apply(current === p ? undefined : p)}>
            <span className="num">{formatRest(p, locale)}</span>
          </Chip>
        ))}
        {!isKnown && !customOpen && current !== undefined && (
          <Chip selected onClick={() => apply(undefined)}>
            <span className="num">{formatRest(current, locale)}</span>
          </Chip>
        )}
        <Chip
          selected={customOpen}
          onClick={() => {
            setDraft(isKnown || current === undefined ? '' : String(current))
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
            <span className="sr-only">{m.customRest}</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              type="number"
              min={0}
              max={REST_MAX}
              step={REST_STEP}
              placeholder={m.restPlaceholder}
              inputMode="numeric"
              className="num h-11 w-full rounded-md bg-surface-2 px-3 text-base placeholder:text-ink-3"
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

const NONE = -1

export function RirPicker({ entry, onChange, className }: { entry: Entry; onChange: Run; className?: string }) {
  const setRir = useProgramStore((s) => s.setRir)
  const locale = useLocale()
  const m = builderMessages[locale]
  const options = [{ value: NONE, label: m.rirNone }, ...Array.from({ length: RIR_MAX + 1 }, (_, i) => ({ value: i, label: String(i) }))]

  return (
    <div className={className}>
      <h3 className="text-sm font-semibold">{m.rirTitle}</h3>
      <p className="mt-0.5 text-sm text-ink-2">{m.rirHint}</p>
      <ChipGroup
        label={m.rirTitle}
        options={options}
        value={entry.rir ?? NONE}
        onChange={(v) => {
          const next = v === null || v === NONE ? undefined : v
          if (next === entry.rir) return
          onChange(next === undefined ? m.rirCleared : m.rirSetTo(next), () => setRir(entry.id, next))
        }}
        className="mt-2"
      />
    </div>
  )
}

/** Pairs the entry with the one above it; when linked, tapping unlinks. */
export function SupersetToggle({ entry, index, day, exercise, onChange, className }: {
  entry: Entry
  index: number
  day: number
  exercise: AnyExercise
  onChange: Run
  className?: string
}) {
  const program = useActiveProgram()
  const { catalog } = useCatalog()
  const link = useProgramStore((s) => s.linkWithPrev)
  const locale = useLocale()
  const m = builderMessages[locale]
  const reasonId = useId()
  const entries = program?.days[day]?.entries ?? []
  const on = Boolean(entry.withPrev)
  const can = on || canLinkWithPrev(entries, index)
  const above = entries[index - 1]
  const reason = can
    ? null
    : index === 0
      ? m.supersetFirst
      : entries[index + 1]?.withPrev
        ? m.supersetBelowTaken
        : m.supersetAboveTaken

  const toggle = () => {
    if (on) onChange(m.supersetRemoved, () => link(entry.id, false))
    else {
      const aboveName = (above && exerciseFor(above.exerciseId, catalog, program)?.name) ?? m.someExercise
      onChange(m.supersetMade(aboveName, exercise.name), () => link(entry.id, true))
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={!can}
        aria-describedby={reason ? reasonId : undefined}
        onClick={toggle}
        className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left text-base hover:bg-surface-2 disabled:opacity-45 disabled:hover:bg-transparent"
      >
        <span className="flex-1">{m.supersetWithAbove}</span>
        <span className="text-sm text-ink-2">{on ? m.supersetOn : m.supersetOff}</span>
        <span aria-hidden className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', on ? 'bg-ink' : 'bg-surface-2 ring-1 ring-inset ring-line-strong')}>
          <span className={cx('absolute top-1 size-5 rounded-full bg-raised shadow-thumb transition-[left]', on ? 'left-6' : 'left-1')} />
        </span>
      </button>
      {reason && (
        <p id={reasonId} className="px-2 pb-1 text-sm text-ink-2">
          {reason}
        </p>
      )}
    </div>
  )
}

import { Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { bandExplanationFor, bandLabelFor, bandTargetText, citedRangeText, isPersonal } from '../../app/bands'
import { dayName, daySlug, type DayIndex } from '../../app/days'
import { formatSets } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import type { WeekView } from '../../app/useWeek'
import { headShade, VOLUME_COLOR } from '../../app/volumeScale'
import { groupName, headName } from '../../data/localize'
import { suggestions } from '../../domain/coverage'
import type { Exercise } from '../../domain/schema'
import { allHeadsOfGroup, getGroup, headsOfGroup, isBanded } from '../../domain/taxonomy'
import { common } from '../../i18n/common'
import { useLocale } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { useProgramStore } from '../../store/program.store'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Pill } from '../../ui/Pill'
import { Sheet } from '../../ui/Sheet'
import { Stepper } from '../../ui/Stepper'
import { sheetState } from '../../ui/useSheet'
import { DayPicker } from '../builder'
import { ChangeBar } from '../builder/ChangeBar'
import { builderMessages } from '../builder/messages'
import { carryUndo, undoLastChange, useChange } from '../builder/useChange'
import { ExerciseRow } from '../catalog'
import { scheduleText } from './copy'
import { bodymapMessages } from './messages'
import { DayStrip } from './DayStrip'
import { MuscleLocator } from './MuscleLocator'
import { Why } from './Why'

function Heading({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-7 flex min-h-6 items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-ink">{children}</h3>
      {action}
    </div>
  )
}

export type MuscleSheetProps = {
  open: boolean
  onClose: () => void
  group: string | undefined
  head?: string
  onSelectHead: (head: string | undefined) => void
  view: WeekView
  /** Day scope from the Body tab; "Add exercise" then goes straight to that day. */
  day: DayIndex | null
}

/** Muscle detail: weekly sets, band, day strip, heads, contributing exercises with visible math. */
export function MuscleSheet({ open, onClose, group, head, onSelectHead, view, day }: MuscleSheetProps) {
  const g = group ? getGroup(group) : undefined
  const locale = useLocale()
  const m = bodymapMessages[locale]
  const c = common[locale]
  const [status, setStatus] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setStatus(null)
  }
  const close = () => {
    carryUndo(status)
    onClose()
  }
  return (
    <Sheet
      open={open && Boolean(g)}
      onClose={close}
      title={g ? groupName(g.id, locale) : m.muscle}
      description={g?.banded && g.optional ? m.optionalGroup : undefined}
      footer={
        g ? (
          <>
            {status && (
              <ChangeBar
                className="mb-2"
                message={status}
                onUndo={status !== c.undone ? () => undoLastChange() && setStatus(c.undone) : undefined}
              />
            )}
            <AddFooter group={g.id} view={view} day={day} />
          </>
        ) : undefined
      }
    >
      {g && <Body group={g.id} head={head} onSelectHead={onSelectHead} view={view} day={day} onStatus={setStatus} />}
    </Sheet>
  )
}

function Body({
  group,
  head,
  onSelectHead,
  view,
  day,
  onStatus,
}: {
  group: string
  head?: string
  onSelectHead: (head: string | undefined) => void
  view: WeekView
  day: DayIndex | null
  onStatus: (message: string) => void
}) {
  const { catalog } = useCatalog()
  const locale = useLocale()
  const m = bodymapMessages[locale]
  const b = builderMessages[locale]
  const setSets = useProgramStore((s) => s.setSets)
  const change = useChange()
  const nameOfHead = (id: string) => headName(id, locale)
  const equipment = usePrefsStore((s) => s.equipment)
  const overrides = usePrefsStore((s) => s.overrides)
  const targets = usePrefsStore((s) => s.targets)
  const { week, coverage, schedule, order, program, prefs } = view
  const weekly = week.weekly[group] ?? 0
  const band = week.bands[group]
  const heads = headsOfGroup(group)
  const deep = allHeadsOfGroup(group).filter((h) => !heads.includes(h))
  const hints = new Map(coverage.headHints.filter((h) => h.group === group).map((h) => [h.head, h]))
  const selectedHead = head && heads.includes(head) ? head : undefined
  const position = (d: number) => order.indexOf(d as DayIndex)
  const contributions = [...(week.contributions[group] ?? [])].sort((a, b) => position(a.day) - position(b.day))
  const nameOf = (ref: number | string) =>
    typeof ref === 'number' ? catalog.get(ref)?.name : program.custom.find((c) => c.id === ref)?.name
  const suggestFor = weekly <= 0 || selectedHead
  const suggested = suggestFor
    ? suggestions(group, catalog, equipment, 3, { overrides, head: selectedHead })
    : []

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="num">
            <span className="text-display font-light">{formatSets(weekly, locale)}</span>
            <span className="ml-2 text-base text-ink-2">{m.weeklySets(weekly)}</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
            {band ? (
              <>
                <Pill>{bandLabelFor(band, prefs.goal)}</Pill>
                <span className="text-sm text-ink-2 num">{bandTargetText(band, locale)}</span>
                <Why topic={m.bandTopic(groupName(group, locale))} sources={band.sourceIds}>
                  {band.band === 'target' && band.sourceIds.includes('rp-2023') && !isPersonal(band)
                    ? m.targetRange(band.edges[1], band.edges[2])
                    : bandExplanationFor(band, prefs.goal)}
                  {isPersonal(band) && <p className="mt-2 text-ink-2">{citedRangeText(band.cited, locale)}</p>}
                </Why>
              </>
            ) : (
              <span className="text-sm text-ink-2">{isBanded(group) ? m.skippedNote : m.noBandNote}</span>
            )}
            {isBanded(group) && <ChangeRange group={group} label={m.changeRange} />}
          </div>
        </div>
        <MuscleLocator
          group={group}
          head={selectedHead}
          fill="var(--color-role-primary)"
        />
      </div>

      <Heading>{m.days}</Heading>
      {weekly <= 0 ? (
        <p className="text-sm text-ink-2">{scheduleText(undefined, 0, locale)}</p>
      ) : (
        <DayStrip
          group={group}
          daily={week.daily[group] ?? []}
          order={order}
          selectedDay={day}
          caption={scheduleText(
            schedule.find((s) => s.group === group),
            weekly,
            locale,
          )}
        />
      )}

      {(heads.length > 1 || deep.length > 0) && (
        <>
          <Heading>{m.heads(group)}</Heading>
          {heads.length > 1 && (
            <ul className="-mx-2">
              {heads.map((h) => {
                const value = week.shade.weekly[h] ?? 0
                const hint = hints.get(h)
                const selected = selectedHead === h
                return (
                  <li key={h} className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelectHead(selected ? undefined : h)}
                      className={cx(
                        'flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors',
                        selected ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                      )}
                    >
                      <span
                        className="size-3 shrink-0 rounded-full ring-1 ring-line-strong ring-inset"
                        style={{ background: VOLUME_COLOR[headShade(h, value, 'week', targets)] }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base text-ink">{nameOfHead(h)}</span>
                        {hint && (
                          <span className="block text-sm text-ink-2 num">
                            {m.lighterEmphasis(Math.round(hint.ratio * 100))}
                          </span>
                        )}
                      </span>
                      <span className="num text-base text-ink">{formatSets(Math.round(value * 2) / 2, locale)}</span>
                    </button>
                    {hint && (
                      <Why topic={m.emphasisTopic(nameOfHead(h))} sources={[hint.sourceId]}>
                        {m.emphasisBody}
                      </Why>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {deep.length > 0 && (
            <p className="mt-2 text-sm text-ink-2">
              <span className="text-ink-3">{m.includes}</span>
              {deep.map(nameOfHead).join(', ')}
            </p>
          )}
        </>
      )}

      {contributions.length > 0 && (
        <>
          <Heading
            action={
              <Why topic={m.howSetsCount} sources={['pelland-2026']}>
                {m.howSetsCountBody}
              </Why>
            }
          >
            {m.fromYourExercises}
          </Heading>
          <ul className="@container divide-y divide-line">
            {contributions.map((c) => {
              const name = nameOf(c.exerciseRef) ?? m.unknownExercise
              const ex = typeof c.exerciseRef === 'number' ? catalog.get(c.exerciseRef) : undefined
              const body = (
                <>
                  <span className="block truncate text-base text-ink @max-3xs:whitespace-normal @max-3xs:break-words">{name}</span>
                  <span className="num block text-sm text-ink-2">
                    {dayName(c.day, 'short', locale)} · {m.contribution(c.sets, c.value)}
                  </span>
                </>
              )
              const onDay = `${name} (${dayName(c.day, 'long', locale)})`
              const onSets = (v: number) => {
                const res = change(b.setsChanged(name, v), () => setSets(c.entryId, v), { toast: false })
                if (res) onStatus(res.message)
              }
              return (
                <li key={`${c.entryId}`} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  {ex ? (
                    <Link to="/exercise/$slug" params={{ slug: ex.slug }} className="min-w-0 flex-1 @max-3xs:basis-full">
                      {body}
                    </Link>
                  ) : (
                    <div className="min-w-0 flex-1 @max-3xs:basis-full">{body}</div>
                  )}
                  <Stepper
                    value={c.sets}
                    onChange={onSets}
                    label={b.setsFor(onDay)}
                    decrementLabel={b.fewerSetsOf(onDay)}
                    incrementLabel={b.moreSetsOf(onDay)}
                    className="shrink-0"
                  />
                </li>
              )
            })}
          </ul>
          <p className="num mt-1 flex justify-between border-t border-line-strong pt-2 text-sm font-medium text-ink">
            <span>{m.total}</span>
            <span>{formatSets(weekly, locale)}</span>
          </p>
        </>
      )}

      {suggested.length > 0 && (
        <>
          <Heading>{selectedHead ? m.mostEmphasis(nameOfHead(selectedHead)) : m.ideas}</Heading>
          <p className="-mt-1 mb-1 text-sm text-ink-2">{m.usingEquipment}</p>
          <ul className="divide-y divide-line">
            {suggested.map((s) => (
              <li key={s.exercise.id}>
                <ExerciseRow exercise={s.exercise as Exercise} link />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function ChangeRange({ group, label }: { group: string; label: string }) {
  const navigate = useNavigate()
  return (
    <Button
      variant="link"
      size="sm"
      onClick={() => void navigate({ to: '/settings', search: { sheet: 'targets', group }, state: sheetState('targets') })}
    >
      {label}
    </Button>
  )
}

function AddFooter({ group, view, day }: { group: string; view: WeekView; day: DayIndex | null }) {
  const navigate = useNavigate()
  const [picking, setPicking] = useState(false)
  const locale = useLocale()
  const m = bodymapMessages[locale]
  const go = (d: DayIndex) =>
    void navigate({ to: '/day/$dow', params: { dow: daySlug(d) }, search: { sheet: 'add', tab: 'muscle', group }, state: sheetState('add') })

  if (picking && day === null) {
    const hints: Partial<Record<DayIndex, string>> = {}
    for (const d of view.order) {
      const sets = view.week.daily[group]?.[d] ?? 0
      if (view.program.days[d].kind === 'rest') hints[d] = m.rest
      else if (sets > 0) hints[d] = formatSets(sets, locale)
    }
    return (
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-ink">{m.addToWhichDay}</p>
          <Button variant="link" size="sm" onClick={() => setPicking(false)}>
            {common[locale].cancel}
          </Button>
        </div>
        <DayPicker label={m.addToWhichDay} value={[]} hints={hints} onChange={(days) => days[0] !== undefined && go(days[0])} />
      </div>
    )
  }
  return (
    <Button variant="primary" block icon={Plus} onClick={() => (day === null ? setPicking(true) : go(day))}>
      {day === null ? m.addForMuscle : m.addOnDay(day)}
    </Button>
  )
}

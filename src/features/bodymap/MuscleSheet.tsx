import { Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { bandExplanationFor, bandLabelFor, targetText } from '../../app/bands'
import { dayName, daySlug, type DayIndex } from '../../app/days'
import { formatSets } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import type { WeekView } from '../../app/useWeek'
import { headShade, VOLUME_COLOR } from '../../app/volumeScale'
import { groupName, headName } from '../../data/localize'
import { suggestions } from '../../domain/coverage'
import type { Exercise } from '../../domain/schema'
import { allHeadsOfGroup, getGroup, headsOfGroup } from '../../domain/taxonomy'
import { common } from '../../i18n/common'
import { useLocale } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Pill } from '../../ui/Pill'
import { Sheet } from '../../ui/Sheet'
import { sheetState } from '../../ui/useSheet'
import { DayPicker } from '../builder'
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
  return (
    <Sheet
      open={open && Boolean(g)}
      onClose={onClose}
      title={g ? groupName(g.id, locale) : m.muscle}
      description={g?.banded && g.optional ? m.optionalGroup : undefined}
      footer={g ? <AddFooter group={g.id} view={view} day={day} /> : undefined}
    >
      {g && <Body group={g.id} head={head} onSelectHead={onSelectHead} view={view} day={day} />}
    </Sheet>
  )
}

function Body({
  group,
  head,
  onSelectHead,
  view,
  day,
}: {
  group: string
  head?: string
  onSelectHead: (head: string | undefined) => void
  view: WeekView
  day: DayIndex | null
}) {
  const { catalog } = useCatalog()
  const locale = useLocale()
  const m = bodymapMessages[locale]
  const nameOfHead = (id: string) => headName(id, locale)
  const equipment = usePrefsStore((s) => s.equipment)
  const overrides = usePrefsStore((s) => s.overrides)
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
                <span className="text-sm text-ink-2 num">{targetText(band.edges)}</span>
                <Why topic={m.bandTopic(groupName(group, locale))} sources={band.sourceIds}>
                  {band.band === 'target' && band.sourceIds.includes('rp-2023')
                    ? m.targetRange(band.edges[1], band.edges[2])
                    : bandExplanationFor(band, prefs.goal)}
                </Why>
              </>
            ) : (
              <span className="text-sm text-ink-2">{m.noBandNote}</span>
            )}
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
                        style={{ background: VOLUME_COLOR[headShade(h, value, 'week')] }}
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
          <ul className="divide-y divide-line">
            {contributions.map((c) => {
              const name = nameOf(c.exerciseRef) ?? m.unknownExercise
              const ex = typeof c.exerciseRef === 'number' ? catalog.get(c.exerciseRef) : undefined
              const body = (
                <>
                  <span className="min-w-0 flex-1 truncate text-base text-ink">{name}</span>
                  <span className="num shrink-0 text-sm text-ink-2">
                    {dayName(c.day, 'short', locale)} · {m.contribution(c.sets, c.value)}
                  </span>
                </>
              )
              return (
                <li key={`${c.entryId}`}>
                  {ex ? (
                    <Link
                      to="/exercise/$slug"
                      params={{ slug: ex.slug }}
                      className="flex min-h-12 items-center gap-3 py-2"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex min-h-12 items-center gap-3 py-2">{body}</div>
                  )}
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

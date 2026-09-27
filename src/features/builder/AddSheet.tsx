import { Link } from '@tanstack/react-router'
import { Check, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { bandLabel } from '../../app/bands'
import { dayName, type DayIndex } from '../../app/days'
import { formatDelta, formatSets, joinMeta, plural } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import { useWeek } from '../../app/useWeek'
import { suggestions } from '../../domain/coverage'
import { availableSet, equipment as equipmentItems, hasEquipment } from '../../domain/equipment'
import { resolveExercise } from '../../domain/resolve'
import type { Pattern } from '../../domain/schema'
import { bandedGroupIds, groupIds, isOptional } from '../../domain/taxonomy'
import { bandFor, type WeekResult } from '../../domain/volume'
import { usePrefsStore } from '../../store/prefs.store'
import { useProgramStore } from '../../store/program.store'
import { BodyMini } from '../bodymap'
import { Button, ChipGroup, IconButton, SegmentedControl, Sheet, cx } from '../../ui'
import { ChangeBar } from './ChangeBar'
import { addPreview } from './delta'
import { PATTERN_GROUPS, PATTERN_LABEL, buildIndex, filterExercises } from '../catalog'
import {
  defaultReps,
  defaultSets,
  groupName,
  isCustom,
  matchesQuery,
  repsText,
  unitOf,
  type AnyExercise,
} from './labels'
import { PickRow } from './PickRow'
import { undoLastChange, useChange } from './useChange'

export type AddTab = 'suggested' | 'muscle' | 'equipment' | 'pattern'

export type AddSheetProps = {
  open: boolean
  day: DayIndex
  tab?: AddTab
  group?: string
  /** Writes tab and group back to the URL. */
  onParams: (params: { tab?: AddTab; group?: string }) => void
  onClose: () => void
  /** Offered under search results so a catalog gap has a way forward. */
  onCreateCustom?: (name: string) => void
}

type Section = { key: string; title: string; note?: string; items: AnyExercise[] }

const TABS: { value: AddTab; label: string }[] = [
  { value: 'suggested', label: 'Suggested' },
  { value: 'muscle', label: 'Muscle' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'pattern', label: 'Pattern' },
]

const byName = (a: AnyExercise, b: AnyExercise) => a.name.localeCompare(b.name)
const PATTERN_ORDER: readonly Pattern[] = PATTERN_GROUPS.flatMap((g) => g.patterns)
const keyOf = (e: AnyExercise) => String(e.id)

export function AddSheet({ open, day, tab = 'suggested', group, onParams, onClose, onCreateCustom }: AddSheetProps) {
  const view = useWeek()
  const { activeExercises, catalog } = useCatalog()
  const prefs = usePrefsStore((s) => s)
  const addEntries = useProgramStore((s) => s.addEntries)
  const change = useChange()

  const [query, setQuery] = useState('')
  const [equipMode, setEquipMode] = useState<'mine' | 'all'>('mine')
  const [equipItem, setEquipItem] = useState<string | null>(null)
  const [pattern, setPattern] = useState<Pattern | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [openWeek, setOpenWeek] = useState<WeekResult | null>(null)
  // Suggestions are frozen at open so rows do not jump away as exercises are added.
  const [openDay, setOpenDay] = useState<ReadonlySet<number | string>>(() => new Set())
  const [wasOpen, setWasOpen] = useState(false)

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuery('')
      setExpanded(null)
      setAdded([])
      setStatus(null)
      setOpenWeek(view?.week ?? null)
      setOpenDay(new Set(view?.program.days[day]?.entries.map((e) => e.exerciseId)))
    }
  }

  const program = view?.program
  const pool = useMemo<AnyExercise[]>(() => [...(program?.custom ?? []), ...activeExercises], [program?.custom, activeExercises])
  const avail = useMemo(() => availableSet(prefs.equipment), [prefs.equipment])
  const fits = (e: AnyExercise) => equipMode === 'all' || hasEquipment(e, avail)
  const ctx = useMemo(
    () => ({ catalog, custom: program?.custom ?? [], countingMode: prefs.countingMode, overrides: prefs.overrides }),
    [catalog, program?.custom, prefs.countingMode, prefs.overrides],
  )
  const rolesOf = (e: AnyExercise) => resolveExercise(e.id, ctx)?.groups ?? {}

  const suggested = useMemo<Section[]>(() => {
    const week = openWeek ?? view?.week
    if (!week || !program) return []
    const shown = new Set<number>()
    const out: Section[] = []
    const eq = equipMode === 'all' ? ['*'] : prefs.equipment
    const push = (g: string, note: string, limit: number) => {
      const items = suggestions(g, catalog, eq, limit + 4, { overrides: prefs.overrides })
        .map((s) => s.exercise)
        .filter((e) => !shown.has(e.id) && !openDay.has(e.id))
        .slice(0, limit)
      items.forEach((e) => shown.add(e.id))
      if (items.length) out.push({ key: g, title: groupName(g), note, items })
    }
    const untrained = bandedGroupIds.filter((g) => (week.weekly[g] ?? 0) <= 0)
    for (const g of untrained.filter((x) => !isOptional(x))) push(g, 'not trained', 3)
    const below = bandedGroupIds
      .filter((g) => !isOptional(g) && (week.weekly[g] ?? 0) > 0)
      .filter((g) => ['light', 'moderate'].includes(week.bands[g]?.band ?? ''))
      .sort((a, b) => week.weekly[a] - week.weekly[b])
    for (const g of below) {
      const band = week.bands[g]
      push(g, joinMeta([`${formatSets(week.weekly[g])} sets`, band && bandLabel(band.band, { goal: prefs.goal })]), 2)
    }
    for (const g of untrained.filter((x) => isOptional(x))) push(g, 'not trained, optional', 2)
    return out
  }, [openWeek, openDay, view?.week, program, catalog, equipMode, prefs.equipment, prefs.overrides, prefs.goal])

  const muscleGroup = group ?? suggested[0]?.key ?? 'chest'
  const muscleChips = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || tab !== 'muscle') return
    muscleChips.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [open, tab, muscleGroup])
  const q = query.trim()
  const index = useMemo(() => buildIndex(activeExercises), [activeExercises])

  const build = (): { sections: Section[]; hidden: number } => {
    let sections: Section[] = []
    let hidden = 0
    const collect = (list: AnyExercise[]) => {
      const visible = list.filter(fits)
      hidden += list.length - visible.length
      return visible
    }
    if (q) {
      const custom = (program?.custom ?? []).filter((e) => matchesQuery(e, q))
      const items = collect([...custom, ...filterExercises(activeExercises, index, { q }, prefs.overrides)])
      sections = [{ key: 'search', title: `${items.length} ${plural(items.length, 'result')}`, items }]
    } else if (tab === 'suggested') {
      const custom = program?.custom ?? []
      sections = [...(custom.length ? [{ key: 'custom', title: 'Your exercises', items: [...custom].sort(byName) }] : []), ...suggested]
    } else if (tab === 'muscle') {
      const primary = collect(pool.filter((e) => rolesOf(e)[muscleGroup]?.role === 'primary')).sort(byName)
      const secondary = collect(pool.filter((e) => rolesOf(e)[muscleGroup]?.role === 'secondary')).sort(byName)
      sections = [
        { key: 'primary', title: `Works ${groupName(muscleGroup).toLowerCase()} directly`, items: primary },
        { key: 'secondary', title: 'Also works it', items: secondary },
      ].filter((s) => s.items.length)
    } else if (tab === 'equipment') {
      const matches = (e: AnyExercise) =>
        !equipItem || (equipItem === 'bodyweight' ? e.equipment.length === 0 : e.equipment.includes(equipItem))
      const items = collect(pool.filter(matches)).sort(byName)
      sections = [{ key: 'equipment', title: `${items.length} ${plural(items.length, 'exercise')}`, items }]
    } else {
      const list = collect(pool.filter((e) => !isCustom(e) && (!pattern || e.pattern === pattern)))
      const byPattern = new Map<Pattern, AnyExercise[]>()
      for (const e of list) {
        if (isCustom(e)) continue
        byPattern.set(e.pattern, [...(byPattern.get(e.pattern) ?? []), e])
      }
      sections = PATTERN_ORDER.filter((p) => byPattern.has(p))
        .map((p) => ({ key: p, title: PATTERN_LABEL[p], items: (byPattern.get(p) ?? []).sort(byName) }))
    }
    return { sections, hidden }
  }
  const { sections, hidden } = build()

  const equipOptions = [
    { value: 'bodyweight', label: 'Bodyweight' },
    ...equipmentItems
      .filter((e) => equipMode === 'all' || avail.has(e.id))
      .map((e) => ({ value: e.id, label: e.name })),
  ]
  const patternsInPool = PATTERN_ORDER.filter((p) => activeExercises.some((e) => e.pattern === p))

  const add = (e: AnyExercise) => {
    const res = change(
      `Added ${e.name}`,
      () => addEntries(day, [e.id], defaultSets(e), defaultReps(e, prefs.goal)),
      { toast: false },
    )
    if (!res) return
    setAdded((a) => [...a, keyOf(e)])
    setStatus(res.message)
  }

  const undo = () => {
    if (!undoLastChange()) return
    setAdded((a) => a.slice(0, -1))
    setStatus('Undone')
  }

  const week = view?.week
  const title = `Add to ${dayName(day, 'long')}`

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      headerEnd={
        added.length > 0 ? (
          <Button variant="primary" size="sm" onClick={onClose} className="mt-1.5">
            Done ({added.length})
          </Button>
        ) : undefined
      }
      footer={
        <ChangeBar
          message={status ?? 'Tap a row to see how it changes your week.'}
          onUndo={status && status !== 'Undone' && added.length ? undo : undefined}
        />
      }
    >
      <div className="sticky top-0 z-10 -mx-5 bg-raised px-5 pb-2 pt-1">
        <label className="relative block">
          <span className="sr-only">Search exercises</span>
          <Search size={18} strokeWidth={1.75} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search, e.g. RDL or bench"
            enterKeyHint="search"
            autoComplete="off"
            className="h-11 w-full rounded-md bg-surface-2 pl-10 pr-10 text-base text-ink placeholder:text-ink-3 focus-visible:outline-2 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="hit absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-2 hover:bg-line"
            >
              <X size={16} strokeWidth={2} aria-hidden />
            </button>
          )}
        </label>
        {!q && (
          <div className="mt-3 space-y-2.5">
            <ChipGroup
              label="Browse by"
              scroll
              options={TABS}
              value={tab}
              onChange={(v) => v && onParams({ tab: v === 'suggested' ? undefined : v, group })}
            />
            {tab === 'muscle' && (
              <div ref={muscleChips}>
                <ChipGroup
                  label="Muscle"
                  scroll
                  size="sm"
                  options={groupIds.map((g) => ({ value: g, label: groupName(g) }))}
                  value={muscleGroup}
                  onChange={(v) => v && onParams({ tab, group: v })}
                />
              </div>
            )}
            {tab === 'equipment' && (
              <>
                <SegmentedControl
                  label="Equipment"
                  size="sm"
                  block
                  options={[
                    { value: 'mine', label: 'Mine' },
                    { value: 'all', label: 'All equipment' },
                  ]}
                  value={equipMode}
                  onChange={(v) => {
                    setEquipMode(v)
                    setEquipItem(null)
                  }}
                />
                <ChipGroup label="Equipment item" scroll size="sm" allowEmpty options={equipOptions} value={equipItem} onChange={setEquipItem} />
              </>
            )}
            {tab === 'pattern' && (
              <ChipGroup
                label="Pattern"
                scroll
                size="sm"
                allowEmpty
                options={patternsInPool.map((p) => ({ value: p, label: PATTERN_LABEL[p] }))}
                value={pattern}
                onChange={setPattern}
              />
            )}
          </div>
        )}
      </div>

      {sections.length === 0 && (
        <p className="py-8 text-center text-base text-ink-2">
          {q ? `No exercise matches "${q}".` : tab === 'suggested' ? 'Every group already has sets this week.' : 'Nothing here yet.'}
        </p>
      )}

      {sections.map((s) => (
        <section key={s.key} className="mt-3">
          <h3 className="flex items-baseline gap-2 pt-2 text-sm font-semibold text-ink">
            {s.title}
            {s.note && <span className="font-normal text-ink-3">{s.note}</span>}
          </h3>
          <ul className="divide-y divide-line">
            {s.items.map((e) => {
              const key = keyOf(e)
              const rowKey = `${s.key}:${key}`
              const count = added.filter((a) => a === key).length
              const sets = defaultSets(e)
              const reps = defaultReps(e, prefs.goal)
              return (
                <li key={rowKey}>
                  <PickRow
                    exercise={e}
                    expanded={expanded === rowKey}
                    onToggle={() => setExpanded(expanded === rowKey ? null : rowKey)}
                    trailing={
                      <>
                        {count > 0 && (
                          <span className="num flex items-center gap-0.5 text-sm text-ink-2" aria-label={`Added ${count} ${plural(count, 'time')}`}>
                            <Check size={14} strokeWidth={2.25} aria-hidden />
                            {count > 1 ? count : null}
                          </span>
                        )}
                        <IconButton icon={Plus} variant="tonal" label={`Add ${e.name}`} onClick={() => add(e)} />
                      </>
                    }
                  >
                    {week && (
                      <AddPreview
                        exercise={e}
                        sets={sets}
                        reps={reps}
                        day={day}
                        roles={Object.fromEntries(Object.entries(rolesOf(e)).map(([g, r]) => [g, r.role]))}
                        deltas={addPreview(e.id, sets, week, ctx)}
                        goal={prefs.goal}
                      />
                    )}
                  </PickRow>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {q && onCreateCustom && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3">
          <p className="text-sm text-ink-2">{sections[0]?.items.length ? 'Not listed?' : 'Not in the catalog yet?'}</p>
          <Button variant="link" size="sm" onClick={() => onCreateCustom(q)}>
            Create a custom exercise
          </Button>
        </div>
      )}

      {hidden > 0 && equipMode === 'mine' && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3">
          <p className="text-sm text-ink-2">
            {hidden} more {plural(hidden, 'needs', 'need')} equipment you have not selected.
          </p>
          <Button variant="link" size="sm" onClick={() => setEquipMode('all')}>
            Show all
          </Button>
        </div>
      )}
      {equipMode === 'all' && (
        <div className="mt-4 flex justify-center">
          <Button variant="link" size="sm" onClick={() => setEquipMode('mine')}>
            Only my equipment
          </Button>
        </div>
      )}
    </Sheet>
  )
}

function AddPreview({
  exercise,
  sets,
  reps,
  day,
  roles,
  deltas,
  goal,
}: {
  exercise: AnyExercise
  sets: number
  reps: string | undefined
  day: DayIndex
  roles: Record<string, 'primary' | 'secondary'>
  deltas: ReturnType<typeof addPreview>
  goal: 'hypertrophy' | 'strength' | 'general'
}) {
  return (
    <div className="mb-3 flex gap-4 rounded-lg bg-surface-2/60 p-3">
      <BodyMini view="both" roles={roles} height={88} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-2">
          {sets} {plural(sets, 'set')}
          {reps ? ` of ${repsText(reps, unitOf(exercise))}` : ''} on {dayName(day, 'long')}
        </p>
        <ul className="mt-2 space-y-1">
          {deltas.map((d) => {
            const band = bandFor(d.group, d.to)
            return (
              <li key={d.group} className="num text-sm">
                <span className="font-medium text-ink">{groupName(d.group)}</span>{' '}
                <span className="text-ink">{formatDelta(d.from, d.to)}</span>
                {band && <span className="text-ink-2">, {bandLabel(band.band, { goal, optional: band.optional })}</span>}
              </li>
            )
          })}
          {deltas.length === 0 && <li className="text-sm text-ink-2">No counted muscles.</li>}
        </ul>
        {!isCustom(exercise) && (
          <Link
            to="/exercise/$slug"
            params={{ slug: exercise.slug }}
            className={cx('mt-2 inline-block text-sm font-medium text-accent underline-offset-4 hover:underline')}
          >
            Details
          </Link>
        )}
      </div>
    </div>
  )
}

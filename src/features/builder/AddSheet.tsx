import { Link } from '@tanstack/react-router'
import { Check, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { bandLabelFor } from '../../app/bands'
import type { DayIndex } from '../../app/days'
import { formatDelta, joinMeta } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import { useWeek } from '../../app/useWeek'
import { equipmentName, groupName, sessionLabel } from '../../data/localize'
import { availableSet, equipment as equipmentItems, hasEquipment } from '../../domain/equipment'
import { resolveExercise } from '../../domain/resolve'
import type { Pattern } from '../../domain/schema'
import { suggestedSections } from '../../domain/suggest'
import { groupIds } from '../../domain/taxonomy'
import { bandFor, type WeekResult } from '../../domain/volume'
import { common } from '../../i18n/common'
import { compareText } from '../../i18n/format'
import type { Locale } from '../../i18n/locale'
import { useLocale } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { useProgramStore } from '../../store/program.store'
import { Button, ChipGroup, IconButton, MovementSwatch, SegmentedControl, Sheet, cx } from '../../ui'
import { BodyMini } from '../bodymap'
import { PATTERN_GROUPS, buildIndex, filterExercises, patternLabel } from '../catalog'
import { ChangeBar } from '../shared/ChangeBar'
import { addPreview } from '../shared/delta'
import {
  defaultReps,
  defaultSets,
  isCustom,
  matchesQuery,
  repsText,
  unitOf,
  type AnyExercise,
} from '../shared/exercise'
import { undoLastChange, useChange } from '../shared/useChange'
import { builderMessages } from './messages'
import { groupOf } from '../shared/exercise'
import { PickRow } from './PickRow'

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

const TABS: readonly AddTab[] = ['suggested', 'muscle', 'equipment', 'pattern']

const byNameIn = (locale: Locale) => (a: AnyExercise, b: AnyExercise) => compareText(locale, a.name, b.name)
const PATTERN_ORDER: readonly Pattern[] = PATTERN_GROUPS.flatMap((g) => g.patterns)
const keyOf = (e: AnyExercise) => String(e.id)

export function AddSheet({ open, day, tab = 'suggested', group, onParams, onClose, onCreateCustom }: AddSheetProps) {
  const view = useWeek()
  const { activeExercises, catalog } = useCatalog()
  const prefs = usePrefsStore((s) => s)
  const addEntries = useProgramStore((s) => s.addEntries)
  const change = useChange()
  const locale = useLocale()
  const m = builderMessages[locale]
  const byName = byNameIn(locale)

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
    const ranked = suggestedSections({
      week,
      goal: prefs.goal,
      catalog,
      equipment: equipMode === 'all' ? ['*'] : prefs.equipment,
      overrides: prefs.overrides,
      day,
      label: sessionLabel(program.days[day]?.label, 'en'),
      exclude: [...openDay].filter((id) => typeof id === 'number'),
    })
    return ranked.map(({ group: g, kind, exerciseIds }) => {
      const band = week.bands[g]
      const note =
        kind === 'untrained'
          ? m.notTrained
          : kind === 'optional'
            ? m.notTrainedOptional
            : joinMeta([m.weeklySets(week.weekly[g]), band && bandLabelFor(band, prefs.goal, locale)])
      const items = exerciseIds.flatMap((id) => catalog.get(id) ?? [])
      return { key: g, title: groupName(g, locale), note, items }
    })
  }, [openWeek, openDay, view?.week, program, day, catalog, equipMode, prefs.equipment, prefs.overrides, prefs.goal, m, locale])

  const muscleGroup = group ?? suggested[0]?.key ?? 'chest'
  const muscleChips = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || tab !== 'muscle') return
    muscleChips.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [open, tab, muscleGroup])
  const q = query.trim()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pattern labels in the index follow the locale
  const index = useMemo(() => buildIndex(activeExercises), [activeExercises, locale])

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
      sections = [{ key: 'search', title: m.results(items.length), items }]
    } else if (tab === 'suggested') {
      const custom = program?.custom ?? []
      sections = [...(custom.length ? [{ key: 'custom', title: m.yourExercises, items: [...custom].sort(byName) }] : []), ...suggested]
    } else if (tab === 'muscle') {
      const primary = collect(pool.filter((e) => rolesOf(e)[muscleGroup]?.role === 'primary')).sort(byName)
      const secondary = collect(pool.filter((e) => rolesOf(e)[muscleGroup]?.role === 'secondary')).sort(byName)
      sections = [
        { key: 'primary', title: m.worksDirectly(groupName(muscleGroup, locale)), items: primary },
        { key: 'secondary', title: m.alsoWorks, items: secondary },
      ].filter((s) => s.items.length)
    } else if (tab === 'equipment') {
      const matches = (e: AnyExercise) =>
        !equipItem || (equipItem === 'bodyweight' ? e.equipment.length === 0 : e.equipment.includes(equipItem))
      const items = collect(pool.filter(matches)).sort(byName)
      sections = [{ key: 'equipment', title: common[locale].exercises(items.length), items }]
    } else {
      const list = collect(pool.filter((e) => !isCustom(e) && (!pattern || e.pattern === pattern)))
      const byPattern = new Map<Pattern, AnyExercise[]>()
      for (const e of list) {
        if (isCustom(e)) continue
        byPattern.set(e.pattern, [...(byPattern.get(e.pattern) ?? []), e])
      }
      sections = PATTERN_ORDER.filter((p) => byPattern.has(p))
        .map((p) => ({ key: p, title: patternLabel(p, locale), items: (byPattern.get(p) ?? []).sort(byName) }))
    }
    return { sections, hidden }
  }
  const { sections, hidden } = build()

  const equipOptions = [
    { value: 'bodyweight', label: common[locale].bodyweight },
    ...equipmentItems
      .filter((e) => equipMode === 'all' || avail.has(e.id))
      .map((e) => ({ value: e.id, label: equipmentName(e.id, locale) })),
  ]
  const patternsInPool = PATTERN_ORDER.filter((p) => activeExercises.some((e) => e.pattern === p))

  const add = (e: AnyExercise) => {
    const res = change(
      m.added(e.name),
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
    setStatus(common[locale].undone)
  }

  const week = view?.week
  const title = m.addTo(day)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      headerEnd={
        added.length > 0 ? (
          <Button variant="primary" size="sm" onClick={onClose} className="mt-1.5">
            {m.doneCount(added.length)}
          </Button>
        ) : undefined
      }
      footer={
        <ChangeBar
          message={status ?? m.addHint}
          onUndo={status && status !== common[locale].undone && added.length ? undo : undefined}
        />
      }
    >
      <div className="sticky top-0 z-10 -mx-5 bg-raised px-5 pb-2 pt-1">
        <label className="relative block">
          <span className="sr-only">{m.searchExercises}</span>
          <Search size={18} strokeWidth={1.75} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={m.searchPlaceholder}
            enterKeyHint="search"
            autoComplete="off"
            className="h-11 w-full rounded-md bg-surface-2 pl-10 pr-10 text-base text-ink placeholder:text-ink-3 focus-visible:outline-2 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={m.clearSearch}
              className="hit absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-2 hover:bg-line"
            >
              <X size={16} strokeWidth={2} aria-hidden />
            </button>
          )}
        </label>
        {!q && (
          <div className="mt-3 space-y-2.5">
            <ChipGroup
              label={m.browseBy}
              scroll
              options={TABS.map((t) => ({ value: t, label: m.tabs[t] }))}
              value={tab}
              onChange={(v) => v && onParams({ tab: v === 'suggested' ? undefined : v, group })}
            />
            {tab === 'muscle' && (
              <div ref={muscleChips}>
                <ChipGroup
                  label={m.muscle}
                  scroll
                  size="sm"
                  options={groupIds.map((g) => ({ value: g, label: groupName(g, locale) }))}
                  value={muscleGroup}
                  onChange={(v) => v && onParams({ tab, group: v })}
                />
              </div>
            )}
            {tab === 'equipment' && (
              <>
                <SegmentedControl
                  label={m.equipment}
                  size="sm"
                  block
                  options={[
                    { value: 'mine', label: m.mine },
                    { value: 'all', label: m.allEquipment },
                  ]}
                  value={equipMode}
                  onChange={(v) => {
                    setEquipMode(v)
                    setEquipItem(null)
                  }}
                />
                <ChipGroup label={m.equipmentItem} scroll size="sm" allowEmpty options={equipOptions} value={equipItem} onChange={setEquipItem} />
              </>
            )}
            {tab === 'pattern' && (
              <ChipGroup
                label={m.pattern}
                scroll
                size="sm"
                allowEmpty
                options={patternsInPool.map((p) => ({ value: p, label: patternLabel(p, locale) }))}
                value={pattern}
                onChange={setPattern}
              />
            )}
          </div>
        )}
      </div>

      {sections.length === 0 && (
        <p className="py-8 text-center text-base text-ink-2">
          {q ? m.noMatch(q) : tab === 'suggested' ? m.allHaveSets : m.nothingHere}
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
              const onDay = count > 0 || openDay.has(e.id)
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
                        {count > 1 && (
                          <span className="num text-sm text-ink-2" aria-label={m.addedTimes(count)}>
                            ×{count}
                          </span>
                        )}
                        {onDay ? (
                          <IconButton icon={Check} variant="solid" label={m.addAnother(e.name)} onClick={() => add(e)} />
                        ) : (
                          <IconButton icon={Plus} variant="tonal" label={m.addNamed(e.name)} onClick={() => add(e)} />
                        )}
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
                        already={onDay}
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
          <p className="text-sm text-ink-2">{sections[0]?.items.length ? m.notListed : m.notInCatalog}</p>
          <Button variant="link" size="sm" onClick={() => onCreateCustom(q)}>
            {m.createCustom}
          </Button>
        </div>
      )}

      {hidden > 0 && equipMode === 'mine' && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3">
          <p className="text-sm text-ink-2">
            {m.hiddenNotSelected(hidden)}
          </p>
          <Button variant="link" size="sm" onClick={() => setEquipMode('all')}>
            {m.showAll}
          </Button>
        </div>
      )}
      {equipMode === 'all' && (
        <div className="mt-4 flex justify-center">
          <Button variant="link" size="sm" onClick={() => setEquipMode('mine')}>
            {m.onlyMine}
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
  already,
}: {
  exercise: AnyExercise
  sets: number
  reps: string | undefined
  day: DayIndex
  roles: Record<string, 'primary' | 'secondary'>
  deltas: ReturnType<typeof addPreview>
  goal: 'hypertrophy' | 'strength' | 'general'
  already: boolean
}) {
  const locale = useLocale()
  const m = builderMessages[locale]
  const targets = usePrefsStore((s) => s.targets)
  return (
    <div className="mb-3 flex gap-4 rounded-lg bg-surface-2/60 p-3">
      <BodyMini view="both" roles={roles} height={88} />
      <div className="min-w-0 flex-1">
        <p className="mb-1 flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
          <MovementSwatch group={groupOf(exercise)} label />
          {!isCustom(exercise) && <span className="min-w-0 truncate font-normal text-ink-2">· {patternLabel(exercise.pattern, locale)}</span>}
        </p>
        {already && <p className="text-sm font-medium text-ink">{m.alreadyOn(day)}</p>}
        <p className="text-sm text-ink-2">
          {m.previewLine(sets, reps ? repsText(reps, unitOf(exercise), locale) : undefined, day)}
        </p>
        <ul className="mt-2 space-y-1">
          {deltas.map((d) => {
            const band = bandFor(d.group, d.to, targets)
            return (
              <li key={d.group} className="num text-sm">
                <span className="font-medium text-ink">{groupName(d.group, locale)}</span>{' '}
                <span className="text-ink">{formatDelta(d.from, d.to, locale)}</span>
                {band && <span className="text-ink-2">, {bandLabelFor(band, goal, locale)}</span>}
              </li>
            )
          })}
          {deltas.length === 0 && <li className="text-sm text-ink-2">{m.noCounted}</li>}
        </ul>
        {!isCustom(exercise) && (
          <Link
            to="/exercise/$slug"
            params={{ slug: exercise.slug }}
            className={cx('mt-2 inline-block text-sm font-medium text-accent underline-offset-4 hover:underline')}
          >
            {m.details}
          </Link>
        )}
      </div>
    </div>
  )
}

import { useDraggable } from '@dnd-kit/react'
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Plus, Search, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { dayName, type DayIndex } from '../../../app/days'
import { countLabel, plural } from '../../../app/format'
import { useCatalog } from '../../../app/useCatalog'
import { availableSet, hasEquipment } from '../../../domain/equipment'
import type { CustomExercise, Role } from '../../../domain/schema'
import { groupIds } from '../../../domain/taxonomy'
import { usePrefsStore } from '../../../store/prefs.store'
import { Button, IconButton, cx } from '../../../ui'
import { ExerciseCardMedia, buildIndex, filterExercises, primaryGroupNames, useRoles } from '../../catalog'
import { FilterSelect } from '../../catalog/FilterSelect'
import { groupName, matchesQuery, rowMeta, type AnyExercise } from '../labels'
import { DRAWER_ITEM, type DrawerDragData } from './board'

const STRIP = 'sticky top-[calc(var(--safe-top)+4rem)] h-[calc(100dvh-var(--safe-top)-5rem)] rounded-xl bg-surface'

const primariesOf = (roles: Record<string, Role>) =>
  Object.entries(roles)
    .filter(([, r]) => r === 'primary')
    .map(([g]) => g)

function DaySelect({ value, order, onChange }: { value: DayIndex; order: readonly DayIndex[]; onChange: (d: DayIndex) => void }) {
  const id = useId()
  return (
    <span className="relative inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-line-strong px-3 text-sm font-medium text-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
      <label htmlFor={id} className="sr-only">
        Add to day
      </label>
      <span aria-hidden>
        <span className="text-ink-2">Add to</span> {dayName(value)}
      </span>
      <ChevronDown size={14} strokeWidth={2} aria-hidden className="text-ink-3" />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-x-0 -inset-y-[7px] cursor-pointer appearance-none opacity-0"
      >
        {order.map((d) => (
          <option key={d} value={d}>
            {dayName(d, 'long')}
          </option>
        ))}
      </select>
    </span>
  )
}

function DrawerRow({
  exercise,
  day,
  onAdd,
  onPreview,
}: {
  exercise: AnyExercise
  day: DayIndex
  onAdd: (e: AnyExercise, day: DayIndex) => void
  onPreview: (groups: string[] | null) => void
}) {
  const roles = useRoles(exercise)
  const primaries = primariesOf(roles)
  const data: DrawerDragData = { exercise }
  const { ref, isDragSource } = useDraggable({ id: `drawer:${exercise.id}`, type: DRAWER_ITEM, data })
  return (
    <li
      ref={ref}
      data-drawer-row={exercise.name}
      onPointerEnter={() => onPreview(primaries)}
      onPointerLeave={() => onPreview(null)}
      className={cx(
        'flex cursor-grab items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2/70 active:cursor-grabbing',
        isDragSource && 'opacity-45',
      )}
    >
      <ExerciseCardMedia exercise={exercise} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium leading-snug text-ink">{exercise.name}</span>
        <span className="mt-0.5 block truncate text-xs text-ink-2">{rowMeta(exercise, primaryGroupNames(roles))}</span>
      </span>
      <IconButton
        icon={Plus}
        size={36}
        variant="tonal"
        label={`Add ${exercise.name} to ${dayName(day, 'long')}`}
        onClick={() => onAdd(exercise, day)}
        onFocus={() => onPreview(primaries)}
        onBlur={() => onPreview(null)}
      />
    </li>
  )
}

export type CatalogDrawerProps = {
  custom: readonly CustomExercise[]
  order: readonly DayIndex[]
  /** Target of the "+" buttons. */
  day: DayIndex
  onDay: (day: DayIndex) => void
  onAdd: (exercise: AnyExercise, day: DayIndex) => void
  /** Hovering or focusing a row previews its primary muscles on the map. */
  onPreview: (groups: string[] | null) => void
  onCollapse: () => void
}

/** Always-open exercise list beside the desktop board: drag a row onto a day, or press + for the chosen day. */
export function CatalogDrawer({ custom, order, day, onDay, onAdd, onPreview, onCollapse }: CatalogDrawerProps) {
  const { activeExercises } = useCatalog()
  const equipment = usePrefsStore((s) => s.equipment)
  const overrides = usePrefsStore((s) => s.overrides)
  const [query, setQuery] = useState('')
  const [muscle, setMuscle] = useState<string | undefined>()
  const [all, setAll] = useState(false)
  const index = useMemo(() => buildIndex(activeExercises), [activeExercises])
  const avail = useMemo(() => availableSet(equipment), [equipment])

  const q = query.trim()
  const own = custom.filter((e) => matchesQuery(e, q) && (!muscle || e.groups[muscle] === 'primary'))
  const matches: AnyExercise[] = [...own, ...filterExercises(activeExercises, index, { q, muscle }, overrides)]
  const shown = all ? matches : matches.filter((e) => hasEquipment(e, avail))
  const hidden = matches.length - shown.length

  return (
    <aside aria-label="Exercises" className={cx(STRIP, 'flex w-60 flex-col')}>
      <div className="shrink-0 px-3 pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-md font-semibold">Exercises</h2>
          <IconButton icon={PanelLeftClose} size={36} label="Hide exercises" onClick={onCollapse} className="-mr-1" />
        </div>
        <p className="text-xs text-ink-3">Drag onto a day, or press + to add to the day below.</p>
        <label className="relative mt-3 block">
          <span className="sr-only">Search exercises</span>
          <Search size={16} strokeWidth={1.75} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            autoComplete="off"
            className="h-10 w-full rounded-md bg-surface-2 pl-8 pr-9 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-2 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="hit absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-2 hover:bg-line"
            >
              <X size={14} strokeWidth={2} aria-hidden />
            </button>
          )}
        </label>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <DaySelect value={day} order={order} onChange={onDay} />
          <FilterSelect
            label="Muscle"
            placeholder="Muscle"
            value={muscle}
            groups={[{ label: '', options: groupIds.map((g) => ({ value: g, label: groupName(g) })) }]}
            onChange={setMuscle}
          />
        </div>
        <p className="num mt-2.5 text-xs text-ink-3" aria-live="polite">
          {countLabel(shown.length, 'exercise')}
        </p>
      </div>
      <ul className="scrollbar-none mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2" aria-label="Exercise list">
        {shown.map((e) => (
          <DrawerRow key={String(e.id)} exercise={e} day={day} onAdd={onAdd} onPreview={onPreview} />
        ))}
        {shown.length === 0 && <li className="px-2 py-6 text-center text-sm text-ink-2">No exercise matches.</li>}
      </ul>
      {(hidden > 0 || all) && (
        <div className="shrink-0 border-t border-line px-3 py-2 text-xs text-ink-2">
          {all ? (
            <Button variant="link" size="sm" onClick={() => setAll(false)}>
              Only my equipment
            </Button>
          ) : (
            <>
              {hidden} more {plural(hidden, 'needs', 'need')} other equipment.{' '}
              <Button variant="link" size="sm" onClick={() => setAll(true)}>
                Show all
              </Button>
            </>
          )}
        </div>
      )}
    </aside>
  )
}

/** Collapsed drawer: a slim strip that brings the list back. */
export function DrawerStrip({ onExpand }: { onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label="Show exercises"
      className={cx(STRIP, 'flex w-11 flex-col items-center gap-3 pt-3 text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink')}
    >
      <PanelLeftOpen size={20} strokeWidth={1.75} aria-hidden />
      <span className="text-sm font-medium [writing-mode:vertical-rl]">Exercises</span>
    </button>
  )
}

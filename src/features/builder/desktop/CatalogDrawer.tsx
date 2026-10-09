import { PointerSensor, useDraggable } from '@dnd-kit/react'
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Plus, Search, X } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { dayName, type DayIndex } from '../../../app/days'
import { useCatalog } from '../../../app/useCatalog'
import { availableSet, hasEquipment } from '../../../domain/equipment'
import type { CustomExercise, Role } from '../../../domain/schema'
import { groupIds } from '../../../domain/taxonomy'
import { common } from '../../../i18n/common'
import { useLocale } from '../../../i18n/messages'
import { usePrefsStore } from '../../../store/prefs.store'
import { Button, IconButton, Select, cx } from '../../../ui'
import { ExerciseCardMedia, buildIndex, filterExercises, primaryGroupNames, useRoles } from '../../catalog'
import { FilterSelect } from '../../catalog/FilterSelect'
import { groupName, matchesQuery, rowMeta, type AnyExercise } from '../labels'
import { SORT_LABEL } from '../dnd'
import { DRAWER_ITEM, WEEK_BOARD_ID, type DrawerDragData } from './board'
import { desktopMessages } from './messages'

const STRIP = 'min-h-0 rounded-xl bg-surface'

// Pointer only, with the library's click-safe defaults: the "+" buttons are the keyboard path.
const sensors = [PointerSensor]
const ADD_ATTR = 'data-drawer-add'
const ROVE_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End']

const primariesOf = (roles: Record<string, Role>) =>
  Object.entries(roles)
    .filter(([, r]) => r === 'primary')
    .map(([g]) => g)

function DaySelect({ value, order, onChange }: { value: DayIndex; order: readonly DayIndex[]; onChange: (d: DayIndex) => void }) {
  const locale = useLocale()
  const m = desktopMessages[locale]
  return (
    <Select
      label={m.addToDay}
      variant="custom"
      value={value}
      groups={[{ options: order.map((d) => ({ value: d, label: dayName(d, 'long', locale) })) }]}
      onChange={onChange}
      className="hit inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-line-strong px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
    >
      <span aria-hidden>
        <span className="text-ink-2">{m.addToPrefix}</span> {dayName(value, 'short', locale)}
      </span>
      <ChevronDown size={14} strokeWidth={2} aria-hidden className="text-ink-3" />
    </Select>
  )
}

function DrawerRow({
  exercise,
  day,
  tabbable,
  onAdd,
  onPreview,
  onFocusAdd,
}: {
  exercise: AnyExercise
  day: DayIndex
  /** Roving tabindex: only one "+" in the list is a tab stop. */
  tabbable: boolean
  onAdd: (e: AnyExercise, day: DayIndex) => void
  onPreview: (groups: string[] | null) => void
  onFocusAdd: () => void
}) {
  const roles = useRoles(exercise)
  const locale = useLocale()
  const m = desktopMessages[locale]
  const primaries = primariesOf(roles)
  const data: DrawerDragData = { exercise }
  const { ref, handleRef, isDragSource } = useDraggable({ id: `drawer:${exercise.id}`, type: DRAWER_ITEM, data, sensors })
  return (
    <li
      ref={ref}
      data-drawer-row={exercise.name}
      {...{ [SORT_LABEL]: exercise.name }}
      onPointerEnter={() => onPreview(primaries)}
      onPointerLeave={() => onPreview(null)}
      className={cx(
        'relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2/70',
        isDragSource && 'opacity-45',
      )}
    >
      {/* Drag handle over the row. The drag library marks it up as a button; hidden, the row keeps its text. */}
      <span ref={handleRef} aria-hidden tabIndex={-1} className="absolute inset-0 cursor-grab rounded-lg active:cursor-grabbing" />
      <ExerciseCardMedia exercise={exercise} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium leading-snug text-ink">{exercise.name}</span>
        <span className="mt-0.5 block truncate text-xs text-ink-2">{rowMeta(exercise, primaryGroupNames(roles), locale)}</span>
      </span>
      <IconButton
        icon={Plus}
        size={36}
        variant="tonal"
        label={m.addTo(exercise.name, day)}
        tabIndex={tabbable ? 0 : -1}
        {...{ [ADD_ATTR]: '' }}
        onClick={() => onAdd(exercise, day)}
        onFocus={() => {
          onFocusAdd()
          onPreview(primaries)
        }}
        onBlur={() => onPreview(null)}
      />
    </li>
  )
}

function roveAdd(e: KeyboardEvent<HTMLUListElement>) {
  if (!ROVE_KEYS.includes(e.key)) return
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(`button[${ADD_ATTR}]`)]
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (at < 0) return
  e.preventDefault()
  const last = buttons.length - 1
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? last : Math.min(last, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))
  buttons[next].focus()
}

function skipToBoard(e: MouseEvent<HTMLAnchorElement>) {
  const board = document.getElementById(WEEK_BOARD_ID)
  if (!board) return
  e.preventDefault()
  board.focus()
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
  const [focused, setFocused] = useState<string | null>(null)
  const locale = useLocale()
  const m = desktopMessages[locale]
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pattern labels in the index follow the locale
  const index = useMemo(() => buildIndex(activeExercises), [activeExercises, locale])
  const avail = useMemo(() => availableSet(equipment), [equipment])

  const q = query.trim()
  const own = custom.filter((e) => matchesQuery(e, q) && (!muscle || e.groups[muscle] === 'primary'))
  const matches: AnyExercise[] = [...own, ...filterExercises(activeExercises, index, { q, muscle }, overrides)]
  const shown = all ? matches : matches.filter((e) => hasEquipment(e, avail))
  const hidden = matches.length - shown.length
  const rover = shown.some((e) => String(e.id) === focused) ? focused : shown[0] ? String(shown[0].id) : null

  return (
    <aside aria-label={m.exercises} className={cx(STRIP, 'flex w-60 flex-col')}>
      <div className="shrink-0 px-3 pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-md font-semibold">{m.exercises}</h2>
          <IconButton icon={PanelLeftClose} size={36} label={m.hideExercises} onClick={onCollapse} className="-mr-1" />
        </div>
        <p className="text-xs text-ink-3">
          {m.drawerHint}
          <span className="sr-only">{m.drawerHintSr}</span>
        </p>
        <label className="relative mt-3 block">
          <span className="sr-only">{m.searchExercises}</span>
          <Search size={16} strokeWidth={1.75} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={m.search}
            autoComplete="off"
            className="h-10 w-full rounded-md bg-surface-2 pl-8 pr-9 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-2 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={m.clearSearch}
              className="hit absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-2 hover:bg-line"
            >
              <X size={14} strokeWidth={2} aria-hidden />
            </button>
          )}
        </label>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <DaySelect value={day} order={order} onChange={onDay} />
          <FilterSelect
            label={m.muscle}
            placeholder={m.muscle}
            value={muscle}
            groups={[{ label: '', options: groupIds.map((g) => ({ value: g, label: groupName(g, locale) })) }]}
            onChange={setMuscle}
          />
        </div>
        <p className="num mt-2.5 text-xs text-ink-3" aria-live="polite">
          {common[locale].exercises(shown.length)}
        </p>
      </div>
      <a
        href={`#${WEEK_BOARD_ID}`}
        onClick={skipToBoard}
        className="sr-only focus:not-sr-only focus:mx-3 focus:mt-2 focus:block focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-on-ink"
      >
        {m.skipToBoard}
      </a>
      <ul
        className="scrollbar-none mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2"
        aria-label={m.exerciseList}
        onKeyDown={roveAdd}
      >
        {shown.map((e) => (
          <DrawerRow
            key={String(e.id)}
            exercise={e}
            day={day}
            tabbable={String(e.id) === rover}
            onAdd={onAdd}
            onPreview={onPreview}
            onFocusAdd={() => setFocused(String(e.id))}
          />
        ))}
        {shown.length === 0 && <li className="px-2 py-6 text-center text-sm text-ink-2">{m.noMatch}</li>}
      </ul>
      {(hidden > 0 || all) && (
        <div className="shrink-0 border-t border-line px-3 py-2 text-xs text-ink-2">
          {all ? (
            <Button variant="link" size="sm" onClick={() => setAll(false)}>
              {m.onlyMine}
            </Button>
          ) : (
            <>
              {m.hiddenOther(hidden)}{' '}
              <Button variant="link" size="sm" onClick={() => setAll(true)}>
                {m.showAll}
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
  const m = desktopMessages[useLocale()]
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={m.showExercises}
      className={cx(STRIP, 'flex w-11 flex-col items-center gap-3 pt-3 text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink')}
    >
      <PanelLeftOpen size={20} strokeWidth={1.75} aria-hidden />
      <span className="text-sm font-medium [writing-mode:vertical-rl]">{m.exercises}</span>
    </button>
  )
}

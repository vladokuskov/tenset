import { DragOverlay } from '@dnd-kit/react'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { dayName, daySlug, todayIndex, type DayIndex } from '../../app/days'
import { countLabel, formatDaySummary, plural, setsLabel } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import type { WeekView } from '../../app/useWeek'
import type { Entry, Role } from '../../domain/schema'
import { useProgramStore } from '../../store/program.store'
import { useRoles } from '../catalog'
import { cx } from '../../ui'
import { DRAWER_ITEM, WEEK_BOARD_ID, type DrawerDragData } from './desktop/board'
import { SORT_LABEL, SortableLists, type OtherDrag, type SortMove } from './dnd'
import { useSortableItem, useSortableList } from './useSortable'
import { defaultSets, repsText, unitOf, type AnyExercise } from './labels'
import { exerciseFor } from './lookup'
import { PulseMini } from './PulseMini'
import { useChange } from './useChange'

type Hover = (groups: string[] | null) => void

/** Entry id -> the role the focused muscle plays in it. */
export type BoardHighlight = Readonly<Record<string, Role>>

// Catalog names need up to four lines below 1920px. Columns under 120px (1280-1439 beside the map panel) use a
// smaller size; the cramped drawer-open columns drop the clamp so no name is ever cut.
const NAME = 'line-clamp-4 text-sm font-medium leading-snug text-ink break-words @max-[7.5rem]:text-xs @max-[6.5rem]:line-clamp-none'

function BoardCard({
  entry,
  index,
  day,
  exercise,
  dim,
  lit,
  onHover,
}: {
  entry: Entry
  index: number
  day: DayIndex
  exercise: AnyExercise
  dim: boolean
  /** Undefined when nothing is highlighted, null when this entry is not part of the highlight. */
  lit: Role | null | undefined
  onHover: Hover
}) {
  const { ref, isDragging } = useSortableItem(entry.id, index, String(day))
  const roles = useRoles(exercise)
  const primaries = Object.entries(roles)
    .filter(([, r]) => r === 'primary')
    .map(([g]) => g)
  // The link itself is the drag source: dnd-kit refuses to start a drag from an interactive child.
  return (
    <li onPointerEnter={() => onHover(primaries)} onPointerLeave={() => onHover(null)}>
      <Link
        ref={ref}
        to="/day/$dow"
        params={{ dow: daySlug(day) }}
        search={{ sheet: 'entry', entry: entry.id }}
        draggable={false}
        title={exercise.name}
        {...{ [SORT_LABEL]: `${exercise.name} on ${dayName(day, 'long')}, position ${index + 1}` }}
        onFocus={() => onHover(primaries)}
        onBlur={() => onHover(null)}
        className={cx(
          'block cursor-grab rounded-lg border border-line bg-raised px-2 py-2 transition-[opacity,box-shadow] duration-150 hover:border-line-strong active:cursor-grabbing',
          isDragging && 'shadow-float',
          lit === 'primary' && 'ring-2 ring-accent',
          lit === 'secondary' && 'ring-2 ring-accent/45',
          lit === null ? 'opacity-40' : dim && !lit && 'opacity-55',
        )}
      >
        <span className={NAME}>{exercise.name}</span>
        <span className="num mt-0.5 block text-xs text-ink-2">
          {entry.reps ? `${entry.sets} × ${repsText(entry.reps, unitOf(exercise))}` : `${entry.sets} ${plural(entry.sets, 'set')}`}
        </span>
      </Link>
    </li>
  )
}

function BoardColumn({
  day,
  ids,
  view,
  highlight,
  drops,
  onAdd,
  onHover,
}: {
  day: DayIndex
  ids: readonly string[]
  view: WeekView
  highlight: BoardHighlight | null
  /** Accepts drawer rows as well as board cards. */
  drops: boolean
  onAdd: (day: DayIndex) => void
  onHover: Hover
}) {
  const { catalog } = useCatalog()
  const { ref, isDropTarget } = useSortableList(String(day), drops ? DRAWER_ITEM : undefined)
  const { program, week, days } = view
  const d = program.days[day]
  const s = days[day]
  const rest = d.kind === 'rest'
  const byId = new Map(program.days.flatMap((x) => x.entries).map((e) => [e.id, e]))
  const groups = Object.fromEntries(Object.entries(week.daily).map(([g, v]) => [g, v[day]]))

  return (
    <section
      ref={ref}
      aria-label={dayName(day, 'long')}
      data-drop-target={isDropTarget || undefined}
      {...{ [SORT_LABEL]: dayName(day, 'long') }}
      className={cx(
        '@container flex min-h-[30rem] min-w-0 flex-col rounded-xl bg-surface transition-shadow',
        isDropTarget && 'ring-2 ring-accent',
      )}
    >
      <Link to="/day/$dow" params={{ dow: daySlug(day) }} className="block rounded-t-xl px-3 pb-1 pt-3 hover:bg-surface-2/60">
        <span className="flex items-baseline justify-between gap-1">
          <span className={cx('text-base font-semibold', rest && 'text-ink-3')}>{dayName(day)}</span>
          {day === todayIndex() && <span className="text-[0.6875rem] text-ink-3">Today</span>}
        </span>
        <span className={cx('block truncate text-sm', rest ? 'text-ink-3' : 'text-ink')}>{rest ? 'Rest' : (d.label ?? 'Training')}</span>
        {!rest && (
          <span className="num block text-xs text-ink-2">
            {s.exercises === 0 ? (
              formatDaySummary(0, 0)
            ) : (
              <>
                <span className="whitespace-nowrap">{countLabel(s.exercises, 'exercise')}</span> ·{' '}
                <span className="whitespace-nowrap">{setsLabel(s.hardSets)}</span>
              </>
            )}
          </span>
        )}
      </Link>
      <div className="flex h-16 items-center justify-center px-2">
        {!rest && s.exercises > 0 && <PulseMini view="both" groups={groups} scale="day" height={56} pulseScope={day} />}
      </div>
      <ul className="flex flex-1 flex-col gap-1.5 px-1.5 pb-2">
        {ids.map((id, index) => {
          const entry = byId.get(id)
          const ex = entry ? exerciseFor(entry.exerciseId, catalog, program) : null
          if (!entry || !ex) return null
          const lit = highlight ? (highlight[id] ?? null) : undefined
          return <BoardCard key={id} entry={entry} index={index} day={day} exercise={ex} dim={rest} lit={lit} onHover={onHover} />
        })}
        {ids.length === 0 && (
          <li className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-line-strong px-2 py-6 text-center text-xs text-ink-3">
            {rest ? 'Drop here to train' : 'Drop exercises here'}
          </li>
        )}
      </ul>
      <button
        type="button"
        onClick={() => onAdd(day)}
        className="mx-2 mb-2 flex h-10 items-center justify-center gap-1.5 rounded-md text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        <Plus size={16} strokeWidth={2} aria-hidden />
        Add<span className="sr-only"> to {dayName(day, 'long')}</span>
      </button>
    </section>
  )
}

function DragCard({ exercise }: { exercise: AnyExercise }) {
  const sets = defaultSets(exercise)
  return (
    <div className="flex h-full w-full flex-col justify-center rounded-lg border border-line-strong bg-raised px-3 py-2 shadow-float">
      <span className="line-clamp-2 text-sm font-medium leading-snug text-ink">{exercise.name}</span>
      <span className="num mt-0.5 block text-xs text-ink-2">
        {sets} {plural(sets, 'set')}
      </span>
    </div>
  )
}

const drawerExercise = (drag: OtherDrag) => (drag.type === DRAWER_ITEM ? (drag.data as DrawerDragData).exercise : null)

export type WeekBoardProps = {
  view: WeekView
  onAdd: (day: DayIndex) => void
  /** Hovering or focusing an entry reports its primary groups, null on leave. */
  onHover: Hover
  /** When set, these entries are ringed by role and the others fade. */
  highlight?: BoardHighlight | null
  /** Rendered before the columns inside the board's drag provider, so its DRAWER_ITEM rows can drop on a day. */
  drawer?: ReactNode
  onDropExercise?: (exercise: AnyExercise, day: DayIndex) => void
  /** A drawer row started (exercise) or stopped (null) being dragged. */
  onDragExercise?: (exercise: AnyExercise | null) => void
}

/** Desktop week board: seven columns, drag within and between days, and from the drawer slot onto a day. */
export function WeekBoard({ view, onAdd, onHover, highlight = null, drawer, onDropExercise, onDragExercise }: WeekBoardProps) {
  const { catalog } = useCatalog()
  const reorder = useProgramStore((s) => s.reorder)
  const moveEntry = useProgramStore((s) => s.moveEntry)
  const change = useChange()
  const { program, order } = view
  const lists = Object.fromEntries(order.map((d) => [String(d), program.days[d].entries.map((e) => e.id)]))
  const drops = Boolean(drawer && onDropExercise)

  const onMove = (m: SortMove) => {
    const from = Number(m.fromList)
    const to = Number(m.toList)
    const entry = program.days[from]?.entries[m.fromIndex]
    const name = (entry && exerciseFor(entry.exerciseId, catalog, program)?.name) ?? 'Exercise'
    onHover(null)
    if (from === to) change(`Moved ${name} to position ${m.toIndex + 1}`, () => reorder(from, m.fromIndex, m.toIndex))
    else change(`Moved ${name} to ${dayName(to, 'long')}`, () => moveEntry(m.id, to, m.toIndex))
  }

  return (
    <SortableLists
      lists={lists}
      onMove={onMove}
      onOtherDragStart={(drag) => onDragExercise?.(drawerExercise(drag))}
      onOtherDragEnd={(drag, list) => {
        onDragExercise?.(null)
        const ex = drawerExercise(drag)
        if (ex && list !== null) onDropExercise?.(ex, Number(list))
      }}
    >
      {(current) => (
        <>
          {drawer}
          <div
            id={WEEK_BOARD_ID}
            tabIndex={-1}
            role="group"
            aria-label="Week board"
            className="min-w-0 rounded-xl focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <div className="grid grid-cols-7 gap-2">
              {order.map((d) => (
                <BoardColumn
                  key={d}
                  day={d}
                  ids={current[String(d)] ?? []}
                  view={view}
                  highlight={highlight}
                  drops={drops}
                  onAdd={onAdd}
                  onHover={onHover}
                />
              ))}
            </div>
            {drops && (
              <DragOverlay dropAnimation={null} disabled={(source) => source?.type !== DRAWER_ITEM}>
                {(source) => {
                  const ex = (source.data as DrawerDragData | undefined)?.exercise
                  return ex ? <DragCard exercise={ex} /> : null
                }}
              </DragOverlay>
            )}
          </div>
        </>
      )}
    </SortableLists>
  )
}

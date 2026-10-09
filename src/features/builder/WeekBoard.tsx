import { DragOverlay } from '@dnd-kit/react'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { dayName, daySlug, todayIndex, type DayIndex } from '../../app/days'
import { formatDaySummary, setsLabel } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import type { WeekView } from '../../app/useWeek'
import { sessionLabel } from '../../data/localize'
import type { Entry, Role } from '../../domain/schema'
import { common } from '../../i18n/common'
import { useLocale } from '../../i18n/messages'
import { useProgramStore } from '../../store/program.store'
import { useRoles } from '../catalog'
import { cx } from '../../ui'
import { DRAWER_ITEM, WEEK_BOARD_ID, type DrawerDragData } from './desktop/board'
import { SORT_LABEL, SortableLists, type OtherDrag, type SortMove } from './dnd'
import { useSortableItem, useSortableList } from './useSortable'
import { defaultSets, repsText, supersetLabels, unitOf, type AnyExercise, type SupersetLabel } from './labels'
import { exerciseFor } from './lookup'
import { builderMessages } from './messages'
import { PulseMini } from './PulseMini'
import { useChange } from './useChange'

type Hover = (groups: string[] | null) => void

/** Entry id -> the role the focused muscle plays in it. */
export type BoardHighlight = Readonly<Record<string, Role>>

// Catalog names need up to four lines below 1920px. Columns under 120px (1280-1439 beside the map panel) use a
// smaller size; the cramped drawer-open columns drop the clamp so no name is ever cut.
const NAME = 'line-clamp-4 text-sm font-medium leading-snug text-ink break-words hyphens-auto @max-[7.5rem]:text-xs @max-[6.5rem]:line-clamp-none'

function BoardCard({
  entry,
  index,
  day,
  exercise,
  dim,
  lit,
  superset,
  onHover,
}: {
  entry: Entry
  index: number
  day: DayIndex
  exercise: AnyExercise
  dim: boolean
  /** Undefined when nothing is highlighted, null when this entry is not part of the highlight. */
  lit: Role | null | undefined
  superset: SupersetLabel | null
  onHover: Hover
}) {
  const { ref, isDragging } = useSortableItem(entry.id, index, String(day))
  const roles = useRoles(exercise)
  const locale = useLocale()
  const m = builderMessages[locale]
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
        {...{ [SORT_LABEL]: m.boardSortLabel(exercise.name, day, index + 1) }}
        onFocus={() => onHover(primaries)}
        onBlur={() => onHover(null)}
        className={cx(
          'block cursor-grab rounded-lg border border-line bg-raised px-2 py-1.5 transition-[opacity,box-shadow] duration-150 hover:border-line-strong active:cursor-grabbing',
          isDragging && 'shadow-float',
          lit === 'primary' && 'ring-2 ring-accent',
          lit === 'secondary' && 'ring-2 ring-accent/45',
          lit === null ? 'opacity-40' : dim && !lit && 'opacity-55',
        )}
      >
        <span className={NAME}>{exercise.name}</span>
        <span className="num mt-0.5 block text-xs text-ink-2">
          {superset && (
            <>
              <span aria-hidden className="font-semibold text-ink">{superset.label}</span>
              <span className="sr-only">{m.supersetMarker(superset.letter, superset.position)}</span>
              {' · '}
            </>
          )}
          {entry.reps ? `${entry.sets} × ${repsText(entry.reps, unitOf(exercise), locale)}` : common[locale].sets(entry.sets)}
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
  const locale = useLocale()
  const m = builderMessages[locale]
  const { ref, isDropTarget } = useSortableList(String(day), drops ? DRAWER_ITEM : undefined)
  const { program, week, days } = view
  const d = program.days[day]
  const s = days[day]
  const rest = d.kind === 'rest'
  const byId = new Map(program.days.flatMap((x) => x.entries).map((e) => [e.id, e]))
  const groups = Object.fromEntries(Object.entries(week.daily).map(([g, v]) => [g, v[day]]))
  const labels = supersetLabels(d.entries)
  const supersetOf = new Map(d.entries.map((e, i) => [e.id, labels[i]]))
  const summary = formatDaySummary(s.exercises, s.hardSets, locale, s.estMinutes)

  return (
    <section
      ref={ref}
      aria-label={dayName(day, 'long', locale)}
      data-drop-target={isDropTarget || undefined}
      {...{ [SORT_LABEL]: dayName(day, 'long', locale) }}
      className={cx(
        '@container flex min-h-0 min-w-0 flex-col rounded-xl bg-surface transition-shadow',
        isDropTarget && 'ring-2 ring-accent',
      )}
    >
      <Link to="/day/$dow" params={{ dow: daySlug(day) }} className="block shrink-0 rounded-t-xl px-3 pb-1 pt-2.5 hover:bg-surface-2/60">
        <span className="flex items-baseline justify-between gap-1">
          <span className={cx('text-base font-semibold', rest && 'text-ink-3')}>{dayName(day, 'short', locale)}</span>
          {day === todayIndex() && <span className="text-[0.6875rem] text-ink-3">{m.today}</span>}
        </span>
        <span className={cx('block truncate text-sm', rest ? 'text-ink-3' : 'text-ink')}>{rest ? m.rest : (sessionLabel(d.label, locale) ?? m.training)}</span>
        {!rest && (
          <span className="num block truncate text-xs text-ink-2" title={summary}>
            {s.exercises === 0 ? (
              summary
            ) : (
              <>
                <span aria-hidden>
                  {setsLabel(s.hardSets, locale)}
                  {s.estMinutes > 0 && ` · ${m.minutesShort(s.estMinutes)}`}
                </span>
                <span className="sr-only">{summary}</span>
              </>
            )}
          </span>
        )}
      </Link>
      {/* Short laptop screens give the mini map's height to the list; the week panel shows the same map. */}
      <div className="flex h-12 shrink-0 items-center justify-center px-2 [@media(max-height:52rem)]:hidden">
        {!rest && s.exercises > 0 && <PulseMini view="both" groups={groups} scale="day" height={44} pulseScope={day} />}
      </div>
      <ul className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain px-1.5 pb-1 pt-1">
        {ids.map((id, index) => {
          const entry = byId.get(id)
          const ex = entry ? exerciseFor(entry.exerciseId, catalog, program) : null
          if (!entry || !ex) return null
          const lit = highlight ? (highlight[id] ?? null) : undefined
          return <BoardCard key={id} entry={entry} index={index} day={day} exercise={ex} dim={rest} lit={lit} superset={supersetOf.get(id) ?? null} onHover={onHover} />
        })}
        {ids.length === 0 && (
          <li className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-line-strong px-2 py-6 text-center text-xs text-ink-3">
            {rest ? m.dropToTrain : m.dropHere}
          </li>
        )}
      </ul>
      <button
        type="button"
        onClick={() => onAdd(day)}
        className="mx-2 mb-1.5 flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        <Plus size={16} strokeWidth={2} aria-hidden />
        {m.add}
        <span className="sr-only">{m.addSr(day)}</span>
      </button>
    </section>
  )
}

function DragCard({ exercise }: { exercise: AnyExercise }) {
  const sets = defaultSets(exercise)
  const c = common[useLocale()]
  return (
    <div className="flex h-full w-full flex-col justify-center rounded-lg border border-line-strong bg-raised px-3 py-2 shadow-float">
      <span className="line-clamp-2 text-sm font-medium leading-snug text-ink">{exercise.name}</span>
      <span className="num mt-0.5 block text-xs text-ink-2">
        {c.sets(sets)}
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
  const m = builderMessages[useLocale()]
  const { program, order } = view
  const lists = Object.fromEntries(order.map((d) => [String(d), program.days[d].entries.map((e) => e.id)]))
  const drops = Boolean(drawer && onDropExercise)
  const columns = order
    .map((d) => (program.days[d].kind === 'rest' && program.days[d].entries.length === 0 ? 'minmax(0,0.6fr)' : 'minmax(0,1fr)'))
    .join(' ')

  const onMove = (mv: SortMove) => {
    const from = Number(mv.fromList)
    const to = Number(mv.toList)
    const entry = program.days[from]?.entries[mv.fromIndex]
    const name = (entry && exerciseFor(entry.exerciseId, catalog, program)?.name) ?? m.someExerciseBoard
    onHover(null)
    if (from === to) change(m.movedToPosition(name, mv.toIndex + 1), () => reorder(from, mv.fromIndex, mv.toIndex), { noteSplit: true })
    else change(m.movedTo(name, to), () => moveEntry(mv.id, to, mv.toIndex), { noteSplit: true })
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
            aria-label={m.weekBoard}
            className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            {/* Empty rest days take less width so training days wrap their names less. */}
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-2" style={{ gridTemplateColumns: columns }}>
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

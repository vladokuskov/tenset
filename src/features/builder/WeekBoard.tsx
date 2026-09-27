import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { dayName, daySlug, todayIndex, type DayIndex } from '../../app/days'
import { countLabel, formatDaySummary, plural, setsLabel } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import type { WeekView } from '../../app/useWeek'
import type { Entry } from '../../domain/schema'
import { useProgramStore } from '../../store/program.store'
import { useRoles } from '../catalog'
import { cx } from '../../ui'
import { SORT_LABEL, SortableLists, type SortMove } from './dnd'
import { useSortableItem, useSortableList } from './useSortable'
import { repsText, unitOf, type AnyExercise } from './labels'
import { exerciseFor } from './lookup'
import { PulseMini } from './PulseMini'
import { useChange } from './useChange'

type Hover = (groups: string[] | null) => void

function BoardCard({
  entry,
  index,
  day,
  exercise,
  dim,
  onHover,
}: {
  entry: Entry
  index: number
  day: DayIndex
  exercise: AnyExercise
  dim: boolean
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
        {...{ [SORT_LABEL]: `${exercise.name} on ${dayName(day, 'long')}, position ${index + 1}` }}
        onFocus={() => onHover(primaries)}
        onBlur={() => onHover(null)}
        className={cx(
          'block cursor-grab rounded-lg border border-line bg-raised px-2.5 py-2 transition-shadow hover:border-line-strong active:cursor-grabbing',
          isDragging && 'shadow-float',
          dim && 'opacity-55',
        )}
      >
        <span className="line-clamp-2 text-sm font-medium leading-snug text-ink">{exercise.name}</span>
        <span className="num mt-0.5 block truncate text-xs text-ink-2">
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
  onAdd,
  onHover,
}: {
  day: DayIndex
  ids: readonly string[]
  view: WeekView
  onAdd: (day: DayIndex) => void
  onHover: Hover
}) {
  const { catalog } = useCatalog()
  const { ref, isDropTarget } = useSortableList(String(day))
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
      {...{ [SORT_LABEL]: dayName(day, 'long') }}
      className={cx(
        'flex min-h-[30rem] min-w-0 flex-col rounded-xl bg-surface transition-shadow',
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
      <ul className="flex flex-1 flex-col gap-1.5 px-2 pb-2">
        {ids.map((id, index) => {
          const entry = byId.get(id)
          const ex = entry ? exerciseFor(entry.exerciseId, catalog, program) : null
          if (!entry || !ex) return null
          return <BoardCard key={id} entry={entry} index={index} day={day} exercise={ex} dim={rest} onHover={onHover} />
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

/** Desktop week board: seven columns, drag within and between days. */
export function WeekBoard({ view, onAdd, onHover }: { view: WeekView; onAdd: (day: DayIndex) => void; onHover: Hover }) {
  const { catalog } = useCatalog()
  const reorder = useProgramStore((s) => s.reorder)
  const moveEntry = useProgramStore((s) => s.moveEntry)
  const change = useChange()
  const { program, order } = view
  const lists = Object.fromEntries(order.map((d) => [String(d), program.days[d].entries.map((e) => e.id)]))

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
    <SortableLists lists={lists} onMove={onMove}>
      {(current) => (
        <div className="grid grid-cols-7 gap-2">
          {order.map((d) => (
            <BoardColumn key={d} day={d} ids={current[String(d)] ?? []} view={view} onAdd={onAdd} onHover={onHover} />
          ))}
        </div>
      )}
    </SortableLists>
  )
}


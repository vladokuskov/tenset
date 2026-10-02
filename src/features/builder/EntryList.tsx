import { Link } from '@tanstack/react-router'
import { ChevronDown, Ellipsis, GripVertical, Trash2 } from 'lucide-react'
import { daySlug, type DayIndex } from '../../app/days'
import { useCatalog } from '../../app/useCatalog'
import type { Entry, Program } from '../../domain/schema'
import { useLocale } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { useProgramStore } from '../../store/program.store'
import { ExerciseCardMedia, primaryGroupNames, useRoles } from '../catalog'
import { IconButton, Stepper, cx } from '../../ui'
import { SORT_LABEL, SortableLists, type SortMove } from './dnd'
import { useSortableItem } from './useSortable'
import { defaultReps, isCustom, repsText, rowMeta, unitOf, type AnyExercise } from './labels'
import { exerciseFor } from './lookup'
import { builderMessages } from './messages'
import { useChange } from './useChange'

type Open = (entryId: string) => void

type RowProps = {
  entry: Entry
  index: number
  day: DayIndex
  exercise: AnyExercise
  sortable: boolean
  onOpen: Open
  onOpenReps: Open
}

type RefFn = (el: Element | null) => void

// A disabled dnd-kit sortable still stamps role="button" and aria-disabled on the row, which
// disables every control inside it for assistive tech, so single rows skip the hook entirely.
function EntryRow(props: RowProps) {
  return props.sortable ? <SortableEntryRow {...props} /> : <EntryRowView {...props} />
}

function SortableEntryRow(props: RowProps) {
  const { ref, handleRef, isDragging } = useSortableItem(props.entry.id, props.index, String(props.day))
  return <EntryRowView {...props} rowRef={ref} handleRef={handleRef} isDragging={isDragging} />
}

function EntryRowView({
  entry,
  index,
  day,
  exercise,
  sortable,
  onOpen,
  onOpenReps,
  rowRef,
  handleRef,
  isDragging = false,
}: RowProps & { rowRef?: RefFn; handleRef?: RefFn; isDragging?: boolean }) {
  const roles = useRoles(exercise)
  const setSets = useProgramStore((s) => s.setSets)
  const change = useChange()
  const unit = unitOf(exercise)
  const goal = usePrefsStore((s) => s.goal)
  const reps = entry.reps ?? defaultReps(exercise, goal)
  const locale = useLocale()
  const m = builderMessages[locale]

  const head = (
    <>
      <ExerciseCardMedia exercise={exercise} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-base font-medium leading-snug text-ink">{exercise.name}</span>
        <span className="mt-0.5 block truncate text-sm text-ink-2">
          {rowMeta(exercise, primaryGroupNames(roles), locale)}
        </span>
      </span>
    </>
  )
  const headClass = 'flex min-w-0 flex-1 items-center gap-3 rounded-md py-1'

  return (
    <li
      ref={rowRef}
      className={cx('relative px-1 py-2', isDragging && 'z-10 rounded-lg bg-raised shadow-float')}
      data-entry={entry.id}
      {...{ [SORT_LABEL]: m.sortLabel(exercise.name, index + 1) }}
    >
      <div className="flex items-center gap-1">
        {sortable && (
          <button
            ref={handleRef}
            type="button"
            aria-label={m.reorder(exercise.name)}
            className="hit flex h-12 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-ink-3 hover:text-ink-2 active:cursor-grabbing"
          >
            <GripVertical size={18} strokeWidth={1.75} aria-hidden />
          </button>
        )}
        {isCustom(exercise) ? (
          <div className={headClass}>{head}</div>
        ) : (
          <Link to="/exercise/$slug" params={{ slug: exercise.slug }} search={{ from: daySlug(day) }} className={headClass}>
            {head}
          </Link>
        )}
        <IconButton icon={Ellipsis} size={36} label={m.optionsFor(exercise.name)} onClick={() => onOpen(entry.id)} />
      </div>
      <div className={cx('mt-1 flex flex-wrap items-center gap-x-3 gap-y-2', sortable ? 'pl-[5.5rem]' : 'pl-[3.75rem]')}>
        <Stepper
          value={entry.sets}
          onChange={(v) => change(m.setsChanged(exercise.name, v), () => setSets(entry.id, v))}
          label={m.setsFor(exercise.name)}
          unit={m.setsUnit}
          decrementLabel={m.fewerSetsOf(exercise.name)}
          incrementLabel={m.moreSetsOf(exercise.name)}
        />
        <button
          type="button"
          onClick={() => onOpenReps(entry.id)}
          aria-label={m.repsButton(repsText(reps, unit, locale), !entry.reps, exercise.name)}
          className={cx(
            'hit inline-flex h-8 items-center gap-1 rounded-full border px-3 text-sm font-medium transition-colors hover:bg-surface-2',
            entry.reps ? 'border-line-strong text-ink' : 'border-dashed border-line-strong text-ink-2',
          )}
        >
          <span className="num">{repsText(reps, unit, locale)}</span>
          <ChevronDown size={14} strokeWidth={2} aria-hidden className="text-ink-3" />
        </button>
      </div>
    </li>
  )
}

/** Entries of one day, reordered with the handle (or the keyboard: focus the handle, Space, arrows). */
export function EntryList({ program, day, onOpen, onOpenReps }: { program: Program; day: DayIndex; onOpen: Open; onOpenReps: Open }) {
  const { catalog } = useCatalog()
  const reorder = useProgramStore((s) => s.reorder)
  const removeEntry = useProgramStore((s) => s.removeEntry)
  const change = useChange()
  const m = builderMessages[useLocale()]
  const d = program.days[day]
  const byId = new Map(d.entries.map((e) => [e.id, e]))
  const key = String(day)
  const sortable = d.kind === 'train' && d.entries.length > 1

  const onMove = (mv: SortMove) => {
    const entry = byId.get(mv.id)
    const ex = entry ? exerciseFor(entry.exerciseId, catalog, program) : null
    change(m.movedToPosition(ex?.name ?? m.someExercise, mv.toIndex + 1), () => reorder(day, mv.fromIndex, mv.toIndex))
  }

  return (
    <SortableLists lists={{ [key]: d.entries.map((e) => e.id) }} onMove={onMove}>
      {(lists) => (
        <ul className="divide-y divide-line rounded-xl bg-surface px-2">
          {(lists[key] ?? []).map((id, index) => {
            const entry = byId.get(id)
            if (!entry) return null
            const ex = exerciseFor(entry.exerciseId, catalog, program)
            if (!ex) {
              return (
                <li key={id} className="flex items-center gap-2 py-1 pl-2 text-sm text-ink-2">
                  <span className="min-w-0 flex-1">{m.goneExercise}</span>
                  <IconButton
                    icon={Trash2}
                    size={36}
                    label={m.removeThis}
                    onClick={() => change(m.removedGone, () => removeEntry(id))}
                  />
                </li>
              )
            }
            return <EntryRow key={id} entry={entry} index={index} day={day} exercise={ex} sortable={sortable} onOpen={onOpen} onOpenReps={onOpenReps} />
          })}
        </ul>
      )}
    </SortableLists>
  )
}

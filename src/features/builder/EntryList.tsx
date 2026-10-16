import { Link } from '@tanstack/react-router'
import { ChevronDown, Ellipsis, GripVertical, Trash2 } from 'lucide-react'
import { daySlug, type DayIndex } from '../../app/days'
import { formatRest, formatRir } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import type { Entry, Program } from '../../domain/schema'
import { useLocale } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { useProgramStore } from '../../store/program.store'
import { IconButton, Stepper, cx, mvBg } from '../../ui'
import { ExerciseCardMedia, primaryGroupNames, useRoles } from '../catalog'
import { defaultReps, groupOf, isCustom, repsText, rowMeta, supersetLabels, unitOf, type AnyExercise, type SupersetLabel } from '../shared/exercise'
import { exerciseFor } from '../shared/lookup'
import { sharedMessages } from '../shared/messages'
import { useChange } from '../shared/useChange'
import { SORT_LABEL, SortableLists, type SortMove } from './dnd'
import { builderMessages } from './messages'
import { useSortableItem } from './useSortable'

type Open = (entryId: string) => void

type RowProps = {
  entry: Entry
  index: number
  day: DayIndex
  exercise: AnyExercise
  sortable: boolean
  onOpen: Open
  onOpenReps: Open
  superset: SupersetLabel | null
}

type RefFn = (el: Element | null) => void

const TAG = 'num inline-flex h-8 items-center rounded-full bg-white/55 px-3 text-sm text-mv-ink'

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
  superset,
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
  const sm = sharedMessages[locale]

  const head = (
    <>
      <ExerciseCardMedia exercise={exercise} size="sm" className="@max-3xs:hidden" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-words hyphens-auto text-base font-medium leading-snug @max-3xs:line-clamp-none">{exercise.name}</span>
        <span className="mt-0.5 line-clamp-2 text-sm text-mv-ink/75">
          {rowMeta(exercise, primaryGroupNames(roles), locale)}
        </span>
      </span>
    </>
  )
  const headClass = 'flex min-w-0 flex-1 items-center gap-3 rounded-md py-1 @max-[9rem]:order-last @max-[9rem]:basis-full'

  return (
    <li
      ref={rowRef}
      className={cx('@container relative rounded-xl py-2.5 pl-1 pr-1.5 text-mv-ink', mvBg[groupOf(exercise)], isDragging && 'z-10 shadow-float')}
      data-entry={entry.id}
      data-superset={superset?.label}
      {...{ [SORT_LABEL]: m.sortLabel(exercise.name, index + 1) }}
    >
      {superset && !isDragging && (
        <span
          aria-hidden
          className={cx('absolute -left-2 w-0.5 rounded-full bg-ink-3', superset.position === 1 ? '-bottom-1 top-5' : '-top-1 bottom-5')}
        />
      )}
      <div className="flex items-center justify-between gap-1 @max-[9rem]:flex-wrap">
        {sortable && (
          <button
            ref={handleRef}
            type="button"
            aria-label={m.reorder(exercise.name)}
            className="hit flex h-12 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-mv-ink/60 hover:text-mv-ink active:cursor-grabbing"
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
        <IconButton icon={Ellipsis} size={36} variant="fill" label={m.optionsFor(exercise.name)} onClick={() => onOpen(entry.id)} />
      </div>
      <div className={cx('mt-1 flex flex-wrap items-center gap-x-3 gap-y-2', sortable ? 'pl-[5.5rem]' : 'pl-[3.75rem]', '@max-3xs:pl-0')}>
        {superset && (
          <span className="num inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-mv-ink/45 bg-white/55 px-1.5 text-sm font-semibold">
            <span aria-hidden>{superset.label}</span>
            <span className="sr-only">{m.supersetMarker(superset.letter, superset.position)}</span>
          </span>
        )}
        <Stepper
          value={entry.sets}
          onChange={(v) => change(sm.setsChanged(exercise.name, v), () => setSets(entry.id, v))}
          label={sm.setsFor(exercise.name)}
          unit={m.setsUnit}
          tone="fill"
          decrementLabel={sm.fewerSetsOf(exercise.name)}
          incrementLabel={sm.moreSetsOf(exercise.name)}
        />
        <button
          type="button"
          onClick={() => onOpenReps(entry.id)}
          aria-label={m.repsButton(repsText(reps, unit, locale), !entry.reps, exercise.name)}
          className={cx(
            'hit inline-flex h-8 items-center gap-1 rounded-full border border-mv-ink/30 px-3 text-sm font-medium transition-colors hover:bg-white/45',
            entry.reps ? 'text-mv-ink' : 'border-dashed text-mv-ink/75',
          )}
        >
          <span className="num">{repsText(reps, unit, locale)}</span>
          <ChevronDown size={14} strokeWidth={2} aria-hidden className="text-mv-ink/60" />
        </button>
        {entry.restSec !== undefined && (
          <span className={TAG}>
            <span aria-hidden>{formatRest(entry.restSec, locale)}</span>
            <span className="sr-only">{m.restChip(formatRest(entry.restSec, locale))}</span>
          </span>
        )}
        {entry.rir !== undefined && <span className={TAG}>{formatRir(entry.rir, locale)}</span>}
      </div>
      {entry.note && (
        <p className={cx('mt-1.5 break-words text-sm text-mv-ink/75', sortable ? 'pl-[5.5rem]' : 'pl-[3.75rem]', '@max-3xs:pl-0')}>
          <span aria-hidden>{entry.note}</span>
          <span className="sr-only">{m.noteOn(entry.note)}</span>
        </p>
      )}
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
  const labels = supersetLabels(d.entries)
  const supersetOf = new Map(d.entries.map((e, i) => [e.id, labels[i]]))

  const onMove = (mv: SortMove) => {
    const entry = byId.get(mv.id)
    const ex = entry ? exerciseFor(entry.exerciseId, catalog, program) : null
    change(m.movedToPosition(ex?.name ?? m.someExercise, mv.toIndex + 1), () => reorder(day, mv.fromIndex, mv.toIndex), { noteSplit: true })
  }

  return (
    <SortableLists lists={{ [key]: d.entries.map((e) => e.id) }} onMove={onMove}>
      {(lists) => (
        <ul className="flex flex-col gap-2">
          {(lists[key] ?? []).map((id, index) => {
            const entry = byId.get(id)
            if (!entry) return null
            const ex = exerciseFor(entry.exerciseId, catalog, program)
            if (!ex) {
              return (
                <li key={id} className="flex items-center gap-2 rounded-xl bg-surface py-1 pl-3 pr-1.5 text-sm text-ink-2">
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
            return <EntryRow key={id} entry={entry} index={index} day={day} exercise={ex} sortable={sortable} onOpen={onOpen} onOpenReps={onOpenReps} superset={supersetOf.get(id) ?? null} />
          })}
        </ul>
      )}
    </SortableLists>
  )
}

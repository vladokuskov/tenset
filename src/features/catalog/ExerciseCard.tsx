import type { Exercise } from '../../domain/schema'
import { useLocale } from '../../i18n/messages'
import { cx } from '../../ui/cx'
import { movementLabel } from '../../ui/movement'
import { groupOf } from '../shared/exercise'
import { ExerciseCardMedia } from './ExerciseCardMedia'
import { primaryGroupNames } from './media'
import { catalogMessages } from './messages'

/** Grid card: loop or body map, name, movement group and primary muscles. The whole card opens the preview. */
export function ExerciseCard({ exercise, onOpen, className }: { exercise: Exercise; onOpen: (exercise: Exercise) => void; className?: string }) {
  const locale = useLocale()
  const m = catalogMessages[locale]
  return (
    <article className={cx('group relative min-w-0', className)}>
      <ExerciseCardMedia exercise={exercise} className="transition-[filter] duration-150 group-active:brightness-95" />
      <h2 className="mt-2 line-clamp-2 px-0.5 text-sm font-semibold leading-snug text-ink">{exercise.name}</h2>
      <p className="mt-0.5 truncate px-0.5 text-xs text-ink-2">
        {movementLabel(groupOf(exercise), locale)} · {primaryGroupNames(exercise.groups, locale).join(', ') || m.noMuscles}
      </p>
      <button
        type="button"
        aria-label={m.open(exercise.name)}
        aria-haspopup="dialog"
        onClick={() => onOpen(exercise)}
        className="absolute inset-0 rounded-xl transition-[background-color] duration-150 active:bg-ink/5"
      />
    </article>
  )
}

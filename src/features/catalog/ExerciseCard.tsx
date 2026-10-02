import { Link } from '@tanstack/react-router'
import type { Exercise } from '../../domain/schema'
import { useLocale } from '../../i18n/messages'
import { cx } from '../../ui/cx'
import { Pill } from '../../ui/Pill'
import { ExerciseCardMedia } from './ExerciseCardMedia'
import { primaryGroupNames } from './media'
import { catalogMessages } from './messages'
import { useIsCustomized, useRoles } from './useRoles'

/** Grid card: poster (or the M1 card until the motion is approved), name and primary muscles. The whole card links to the detail screen. */
export function ExerciseCard({ exercise, className }: { exercise: Exercise; className?: string }) {
  const roles = useRoles(exercise)
  const customized = useIsCustomized(exercise)
  const locale = useLocale()
  const m = catalogMessages[locale]
  return (
    <Link
      to="/exercise/$slug"
      params={{ slug: exercise.slug }}
      className={cx('group block min-w-0 rounded-lg', className)}
    >
      <ExerciseCardMedia exercise={exercise} size="md" className="transition-[filter] duration-150 group-active:brightness-95" />
      <span className="mt-2 line-clamp-2 px-0.5 text-sm font-semibold leading-snug text-ink">{exercise.name}</span>
      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 px-0.5 text-xs text-ink-2">
        <span className="truncate">{primaryGroupNames(roles, locale).join(', ') || m.noMuscles}</span>
        {customized && (
          <Pill variant="soft" size="sm">
            {m.custom}
          </Pill>
        )}
      </span>
    </Link>
  )
}

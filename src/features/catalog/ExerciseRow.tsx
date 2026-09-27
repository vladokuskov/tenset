import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { cx } from '../../ui/cx'
import { Pill } from '../../ui/Pill'
import { ExerciseCardMedia } from './ExerciseCardMedia'
import { isCatalogExercise, primaryGroupNames, type CardExercise } from './media'
import { useIsCustomized, useRoles } from './useRoles'

export type ExerciseRowProps = {
  exercise: CardExercise
  /** Second line; defaults to the primary muscle groups. */
  meta?: ReactNode
  /** Trailing controls, e.g. an add button or a sets stepper. Kept outside the tap target. */
  trailing?: ReactNode
  /** Makes the row body a link to /exercise/$slug (catalog exercises only). */
  link?: boolean
  /** Makes the row body a button (ignored when `link` applies). */
  onSelect?: () => void
  className?: string
}

/** One exercise in a list: poster, name, muscles, trailing slot. */
export function ExerciseRow({ exercise, meta, trailing, link, onSelect, className }: ExerciseRowProps) {
  const roles = useRoles(exercise)
  const customized = useIsCustomized(exercise)
  const custom = !isCatalogExercise(exercise)
  const body = (
    <>
      <ExerciseCardMedia exercise={exercise} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-base font-medium leading-snug text-ink">{exercise.name}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-ink-2">
          <span className="truncate">{meta ?? (primaryGroupNames(roles).join(', ') || 'No muscles mapped')}</span>
          {(customized || custom) && (
            <Pill variant="soft" size="sm">
              custom
            </Pill>
          )}
        </span>
      </span>
    </>
  )
  const main = 'flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2 text-left'
  return (
    <div className={cx('flex items-center gap-2', className)}>
      {link && isCatalogExercise(exercise) ? (
        <Link to="/exercise/$slug" params={{ slug: exercise.slug }} className={cx(main, 'rounded-md')}>
          {body}
        </Link>
      ) : onSelect ? (
        <button type="button" onClick={onSelect} className={cx(main, 'rounded-md')}>
          {body}
        </button>
      ) : (
        <div className={main}>{body}</div>
      )}
      {trailing && <div className="flex shrink-0 items-center gap-1">{trailing}</div>}
    </div>
  )
}

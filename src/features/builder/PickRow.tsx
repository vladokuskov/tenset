import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { ExerciseCardMedia, primaryGroupNames, useRoles } from '../catalog'
import { useLocale } from '../../i18n/messages'
import { cx } from '../../ui/cx'
import { rowMeta, type AnyExercise } from './labels'

export type PickRowProps = {
  exercise: AnyExercise
  meta?: ReactNode
  expanded?: boolean
  onToggle?: () => void
  trailing?: ReactNode
  /** Shown under the row while expanded. */
  children?: ReactNode
  className?: string
}

/** Exercise row with an expandable detail area and a trailing action outside the tap target. */
export function PickRow({ exercise, meta, expanded, onToggle, trailing, children, className }: PickRowProps) {
  const roles = useRoles(exercise)
  const locale = useLocale()
  const body = (
    <>
      <ExerciseCardMedia exercise={exercise} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-base font-medium leading-snug text-ink">{exercise.name}</span>
        <span className="mt-0.5 block truncate text-sm text-ink-2">
          {meta ?? rowMeta(exercise, primaryGroupNames(roles), locale)}
        </span>
      </span>
    </>
  )
  const main = 'flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-md py-2 text-left'
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        {onToggle ? (
          <button type="button" aria-expanded={expanded} onClick={onToggle} className={main}>
            {body}
            <ChevronDown
              size={18}
              strokeWidth={1.75}
              aria-hidden
              className={cx('shrink-0 text-ink-3 transition-transform duration-200', expanded && 'rotate-180')}
            />
          </button>
        ) : (
          <div className={main}>{body}</div>
        )}
        {trailing && <div className="flex shrink-0 items-center gap-1">{trailing}</div>}
      </div>
      {expanded && children}
    </div>
  )
}

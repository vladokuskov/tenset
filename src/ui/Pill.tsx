import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export type PillProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode
  /** outline for bands next to numbers; soft for quiet tags such as "custom". */
  variant?: 'outline' | 'soft'
  size?: 'sm' | 'md'
}

/** Neutral text pill. Bands are always words, never colors, so "high" never reads as a warning. */
export function Pill({ children, variant = 'outline', size = 'md', className, ...rest }: PillProps) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-medium text-ink-2',
        size === 'md' ? 'h-6 px-2.5 text-xs' : 'h-5 px-2 text-[0.6875rem]',
        variant === 'outline' ? 'border border-line-strong' : 'bg-surface-2',
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}

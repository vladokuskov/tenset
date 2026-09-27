import type { ReactNode } from 'react'
import { cx } from './cx'

/** Temporary marker for screens a feature agent still has to build. Delete once the screen exists. */
export function Placeholder({ owner, children, className }: { owner: string; children: ReactNode; className?: string }) {
  return (
    <div
      className={cx('rounded-xl border border-dashed border-line-strong px-4 py-3.5 text-sm text-ink-2', className)}
      data-placeholder
    >
      <p className="font-medium text-ink">To be built by the {owner} agent</p>
      <div className="mt-1 space-y-1">{children}</div>
    </div>
  )
}

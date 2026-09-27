import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from './cx'

export type EmptyStateProps = {
  title: ReactNode
  children?: ReactNode
  /** An icon, or custom art such as a grey body silhouette. */
  icon?: LucideIcon
  art?: ReactNode
  /** Primary and secondary actions, usually Buttons. */
  actions?: ReactNode
  className?: string
}

export function EmptyState({ title, children, icon: Icon, art, actions, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-10 text-center', className)}>
      {art ??
        (Icon && (
          <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink-2">
            <Icon size={26} strokeWidth={1.5} aria-hidden />
          </span>
        ))}
      <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      {children && <div className="mt-1.5 max-w-[34ch] text-base text-ink-2">{children}</div>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}

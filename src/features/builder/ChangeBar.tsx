import type { ReactNode } from 'react'
import { cx } from '../../ui/cx'

/** In-sheet version of the change toast (toasts sit under an open dialog). */
export function ChangeBar({
  message,
  onUndo,
  children,
  className,
}: {
  message: string | null
  onUndo?: () => void
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex min-h-11 items-center gap-3', className)}>
      <p role="status" aria-live="polite" className="num min-w-0 flex-1 text-sm text-ink-2">
        {message}
      </p>
      {message && onUndo && (
        <button
          type="button"
          onClick={onUndo}
          className="hit h-9 shrink-0 rounded-md px-3 text-sm font-semibold text-accent hover:bg-surface-2"
        >
          Undo
        </button>
      )}
      {children}
    </div>
  )
}

import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useMessages } from '../i18n/messages'
import { cx } from './cx'
import { IconButton } from './IconButton'
import { uiMessages } from './messages'
import { sheetClosed, sheetOpened } from './sheetFocus'

export type SheetProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Pinned under the scrolling body, e.g. a "Done (3)" button. */
  footer?: ReactNode
  /** Extra controls placed before the close button. */
  headerEnd?: ReactNode
  /** Layout from 1024px up: a floating side panel (default) or a centered panel. */
  desktop?: 'side' | 'center'
  className?: string
}

const EXIT_MS = 360

/**
 * Native <dialog> shown with showModal(): focus trap, Escape, inert page and top layer come
 * from the platform. It is controlled; pair it with useSheet() so the URL owns the open state.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  headerEnd,
  desktop = 'side',
  className,
}: SheetProps) {
  const m = useMessages(uiMessages)
  const ref = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const openRef = useRef(open)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const descId = useId()
  const [lingering, setLingering] = useState(open)
  if (open && !lingering) setLingering(true)

  useEffect(() => {
    openRef.current = open
    onCloseRef.current = onClose
  })

  // Runs before showModal so the opener is read while it still has focus.
  useEffect(() => {
    if (!open) return
    sheetOpened()
    return sheetClosed
  }, [open])

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      // The title, not the first control, so no keyboard or focus ring pops up, also on a deep link.
      titleRef.current?.focus({ preventScroll: true })
    }
    else if (!open && d.open) d.close()
  }, [open])

  useEffect(() => {
    if (open || !lingering) return
    const t = setTimeout(() => setLingering(false), EXIT_MS)
    return () => clearTimeout(t)
  }, [open, lingering])

  useEffect(() => {
    const d = ref.current
    if (!d) return
    const onCancel = (e: Event) => {
      e.preventDefault()
      onCloseRef.current()
    }
    const onNativeClose = () => {
      if (openRef.current) onCloseRef.current()
    }
    d.addEventListener('cancel', onCancel)
    d.addEventListener('close', onNativeClose)
    return () => {
      d.removeEventListener('cancel', onCancel)
      d.removeEventListener('close', onNativeClose)
    }
  }, [])

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={cx('sheet focus-visible:outline-none', className)}
      data-desktop={desktop}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {(open || lingering) && (
        <>
          <div className="flex shrink-0 justify-center pt-2 lg:hidden" aria-hidden>
            <span className="h-1 w-9 rounded-full bg-line-strong" />
          </div>
          <header className="flex shrink-0 items-start gap-2 pb-2 pl-5 pr-2 pt-2 lg:pt-4">
            <div className="min-w-0 flex-1 pt-2.5">
              <h2 ref={titleRef} id={titleId} tabIndex={-1} className="text-lg font-semibold tracking-[-0.01em] text-ink outline-none">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-1 text-sm text-ink-2">
                  {description}
                </p>
              )}
            </div>
            {headerEnd}
            <IconButton icon={X} label={m.close} onClick={onClose} />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
          {footer && (
            <footer className="shrink-0 border-t border-line px-5 pb-[max(1rem,var(--safe-bottom))] pt-3 lg:pb-4">
              {footer}
            </footer>
          )}
          {!footer && <div className="shrink-0 pb-[var(--safe-bottom)] lg:pb-0" />}
        </>
      )}
    </dialog>
  )
}

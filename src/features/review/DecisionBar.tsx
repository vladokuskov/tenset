import { Check, X } from 'lucide-react'
import { forwardRef, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { Button } from '../../ui'
import { cx } from '../../ui/cx'
import { NOTE_MAX } from './record'
import type { Decision } from './types'

type Props = {
  note: string
  onNote: (note: string) => void
  onDecide: (d: Decision) => void
  busy: boolean
  /** shown under the buttons: validation or a failed save */
  message: string | null
}

function Key({ children }: { children: string }) {
  return (
    <kbd aria-hidden className="hidden h-5 min-w-5 items-center justify-center rounded border border-current/30 px-1 font-sans text-[0.6875rem] font-semibold opacity-70 pointer-fine:inline-flex">
      {children}
    </kbd>
  )
}

/** Fixed bottom bar; publishes its height as --actions-h so the page padding and toasts clear it. */
export const DecisionBar = forwardRef<HTMLTextAreaElement, Props>(function DecisionBar({ note, onNote, onDecide, busy, message }, noteRef) {
  const bar = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = bar.current
    if (!el) return
    const root = document.documentElement
    const ro = new ResizeObserver(() => root.style.setProperty('--actions-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--actions-h')
    }
  }, [])

  // grows with the note up to about five lines
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [note])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') e.currentTarget.blur()
  }

  return (
    <div ref={bar} className="glass fixed inset-x-0 bottom-0 z-20 border-t border-line pb-safe">
      <div className="mx-auto w-full max-w-[90rem] px-gutter py-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Review note</span>
            <textarea
              ref={(el) => {
                area.current = el
                if (typeof noteRef === 'function') noteRef(el)
                else if (noteRef) noteRef.current = el
              }}
              rows={1}
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => onNote(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Note for the motion agent (needed to reject)"
              className="block min-h-11 w-full resize-none rounded-md border border-line-strong bg-raised px-3 py-2.5 text-base leading-snug text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
          </label>
          <div className="flex gap-2">
            <Button size="md" icon={X} disabled={busy} onClick={() => onDecide('rejected')} aria-keyshortcuts="R" className="flex-1 md:flex-none">
              Reject <Key>R</Key>
            </Button>
            <Button size="md" variant="primary" icon={Check} disabled={busy} onClick={() => onDecide('approved')} aria-keyshortcuts="A" className="flex-1 md:flex-none">
              Approve <Key>A</Key>
            </Button>
          </div>
        </div>
        <p className={cx('mt-1.5 text-sm', message ? 'text-ink' : 'hidden text-ink-3 pointer-fine:block')} role={message ? 'alert' : undefined}>
          {message ?? 'Keys: A approve, R reject, N next, P previous. Esc leaves the note.'}
        </p>
      </div>
    </div>
  )
})

import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { dismissToast, toastStore } from './toast'

/** Mount once in the root layout. Sits above the tab bar and any sticky action bar. */
export function ToastHost() {
  const toast = useStore(toastStore, (s) => s.current)
  const [paused, setPaused] = useState(false)
  const remaining = useRef(0)
  const startedAt = useRef(0)
  const [prevId, setPrevId] = useState<number | null>(null)

  if ((toast?.id ?? null) !== prevId) {
    setPrevId(toast?.id ?? null)
    setPaused(false)
  }

  useEffect(() => {
    if (toast) remaining.current = toast.duration
  }, [toast])

  useEffect(() => {
    if (!toast || paused) return
    startedAt.current = Date.now()
    const t = setTimeout(() => dismissToast(toast.id), remaining.current)
    return () => {
      clearTimeout(t)
      remaining.current = Math.max(1200, remaining.current - (Date.now() - startedAt.current))
    }
  }, [toast, paused])

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-gutter"
      style={{ bottom: 'calc(var(--chrome-bottom) + var(--actions-h) + 0.75rem)', left: 'var(--chrome-left)' }}
    >
      <div role="status" aria-live="polite" aria-atomic="true" className="w-full max-w-[26rem]">
        {toast && (
          <div
            key={toast.id}
            className="toast-enter pointer-events-auto flex min-h-12 items-center gap-3 rounded-lg bg-ink py-1.5 pl-4 pr-1.5 text-on-ink shadow-float"
            onPointerEnter={() => setPaused(true)}
            onPointerLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          >
            <p className="num min-w-0 flex-1 py-1.5 text-sm">{toast.message}</p>
            {toast.action && (
              <button
                type="button"
                className="hit h-10 shrink-0 rounded-md px-3 text-sm font-semibold text-accent-soft hover:bg-on-ink/10"
                onClick={() => {
                  toast.action?.onAction()
                  dismissToast(toast.id)
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

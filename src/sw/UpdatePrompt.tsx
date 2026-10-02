import { RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { useMessages } from '../i18n/messages'
import { IconButton } from '../ui/IconButton'
import { swMessages } from './messages'
import { useServiceWorkerUpdate } from './update'

/** "New version ready" banner under the top safe area. Mount once in the root layout. */
export function UpdatePrompt() {
  const { ready, apply } = useServiceWorkerUpdate()
  const [dismissed, setDismissed] = useState(false)
  const m = useMessages(swMessages)
  if (!ready || dismissed) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-gutter pt-[calc(var(--safe-top)+0.5rem)] print:hidden" style={{ left: 'var(--chrome-left)' }}>
      <div role="status" className="toast-enter pointer-events-auto flex w-full max-w-[26rem] items-center gap-2 rounded-lg bg-ink py-1.5 pl-4 pr-1.5 text-on-ink shadow-float">
        <RefreshCw size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-on-ink/70" />
        <p className="min-w-0 flex-1 text-sm">{m.updateReady}</p>
        <button type="button" className="hit h-10 shrink-0 rounded-md px-3 text-sm font-semibold text-accent-soft hover:bg-on-ink/10" onClick={apply}>
          {m.reload}
        </button>
        <IconButton icon={X} label={m.later} size={36} className="text-on-ink hover:bg-on-ink/10" onClick={() => setDismissed(true)} />
      </div>
    </div>
  )
}

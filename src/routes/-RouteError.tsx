import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { RotateCcw } from 'lucide-react'
import { isChunkLoadError } from '../app/chunkReload'
import { useMessages } from '../i18n/messages'
import { Button, EmptyState, Page, PageHeader } from '../ui'
import { rootMessages } from './-messages'

/** Also the router's default, so a screen that fails renders inside the app shell. */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter()
  const m = useMessages(rootMessages)
  return (
    <Page>
      <PageHeader title={m.error.title} back={{ to: '/', label: m.plan }} />
      <EmptyState
        icon={RotateCcw}
        title={m.error.heading}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              // A missing chunk needs the new index.html; reloading also clears a cached failed import.
              if (isChunkLoadError(error)) window.location.reload()
              else void router.invalidate()
            }}
          >
            {m.error.action}
          </Button>
        }
      >
        {m.error.body}
        {import.meta.env.DEV && error instanceof Error && (
          <pre className="mt-4 whitespace-pre-wrap text-left text-xs text-ink-3">{error.message}</pre>
        )}
      </EmptyState>
    </Page>
  )
}

import { Link, Outlet, createRootRoute, redirect, useLocation, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { Compass, RotateCcw } from 'lucide-react'
import { BrandMark } from '../app/BrandMark'
import { installChunkReload, isChunkLoadError } from '../app/chunkReload'
import { needsWelcome } from '../app/firstRun'
import { AppProviders } from '../app/providers'
import { useFocusTitleOnNavigate } from '../app/routeFocus'
import { useUndoShortcut } from '../app/undo'
import { useDocumentLocale } from '../i18n/document'
import { useMessages } from '../i18n/messages'
import { UpdatePrompt } from '../sw'
import { Button, EmptyState, LinkButton, NavRail, Page, PageHeader, TabBar, ToastHost } from '../ui'
import { rootMessages } from './-messages'
import { useDocumentTitle } from './-title'

if (typeof window !== 'undefined') installChunkReload()

export const Route = createRootRoute({
  beforeLoad: ({ location }) => {
    if (needsWelcome(location.pathname)) throw redirect({ to: '/welcome', replace: true })
  },
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
})

const BARE = /^\/(welcome|dev)(\/|$)/

function RootLayout() {
  const pathname = useLocation({ select: (l) => l.pathname })
  const bare = BARE.test(pathname)
  useUndoShortcut()
  useFocusTitleOnNavigate()
  useDocumentTitle(pathname)
  // Subscribing here re-renders the whole tree when the language changes.
  useDocumentLocale()
  const m = useMessages(rootMessages)

  return (
    <AppProviders>
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-ink px-4 py-3 text-on-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-[calc(var(--safe-top)+0.75rem)]"
      >
        {m.skip}
      </a>
      {!bare && (
        <NavRail
          brand={
            <Link to="/" aria-label={m.plan} className="block rounded-[10px]">
              <BrandMark size={40} />
            </Link>
          }
        />
      )}
      <main id="content" data-chrome={bare ? 'bare' : undefined} style={{ paddingLeft: 'var(--chrome-left)' }}>
        <Outlet />
      </main>
      {!bare && <TabBar />}
      <ToastHost />
      <UpdatePrompt />
    </AppProviders>
  )
}

function NotFound() {
  const m = useMessages(rootMessages)
  return (
    <Page>
      <PageHeader title={m.notFound.title} back={{ to: '/', label: m.plan }} />
      <EmptyState
        icon={Compass}
        title={m.notFound.heading}
        actions={
          <LinkButton to="/" variant="primary">
            {m.notFound.action}
          </LinkButton>
        }
      >
        {m.notFound.body}
      </EmptyState>
    </Page>
  )
}

function RouteError({ error }: ErrorComponentProps) {
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

import { Link, Outlet, createRootRoute, redirect, useLocation, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { Compass, RotateCcw } from 'lucide-react'
import { BrandMark } from '../app/BrandMark'
import { needsWelcome } from '../app/firstRun'
import { AppProviders } from '../app/providers'
import { useUndoShortcut } from '../app/undo'
import { UpdatePrompt } from '../sw'
import { Button, EmptyState, LinkButton, NavRail, Page, PageHeader, TabBar, ToastHost } from '../ui'

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

  return (
    <AppProviders>
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-ink px-4 py-3 text-on-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-[calc(var(--safe-top)+0.75rem)]"
      >
        Skip to content
      </a>
      {!bare && (
        <NavRail
          brand={
            <Link to="/" aria-label="Plan" className="block rounded-[10px]">
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
  return (
    <Page>
      <PageHeader title="Not found" back={{ to: '/', label: 'Plan' }} />
      <EmptyState
        icon={Compass}
        title="This page does not exist"
        actions={
          <LinkButton to="/" variant="primary">
            Go to Plan
          </LinkButton>
        }
      >
        The link may be old or mistyped.
      </EmptyState>
    </Page>
  )
}

function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <Page>
      <PageHeader title="Something broke" back={{ to: '/', label: 'Plan' }} />
      <EmptyState
        icon={RotateCcw}
        title="This screen failed to load"
        actions={
          <Button variant="primary" onClick={() => void router.invalidate()}>
            Try again
          </Button>
        }
      >
        Your programs are saved on this device and are not affected.
        {import.meta.env.DEV && error instanceof Error && (
          <pre className="mt-4 whitespace-pre-wrap text-left text-xs text-ink-3">{error.message}</pre>
        )}
      </EmptyState>
    </Page>
  )
}

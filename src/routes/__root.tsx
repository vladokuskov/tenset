import { Link, Outlet, createRootRoute, redirect, useLocation } from '@tanstack/react-router'
import { Compass } from 'lucide-react'
import { BrandMark } from '../app/BrandMark'
import { installChunkReload } from '../app/chunkReload'
import { needsWelcome } from '../app/firstRun'
import { AppProviders } from '../app/providers'
import { useFocusTitleOnNavigate } from '../app/routeFocus'
import { useStorageUpkeep } from '../app/storageUpkeep'
import { useUndoShortcut } from '../app/undo'
import { StorageNotices } from '../features/export/StorageNotices'
import { useDocumentLocale } from '../i18n/document'
import { useMessages } from '../i18n/messages'
import { UpdatePrompt } from '../sw'
import { EmptyState, LinkButton, NavRail, Page, PageHeader, TabBar, ToastHost } from '../ui'
import { rootMessages } from './-messages'
import { RouteError } from './-RouteError'
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
  useStorageUpkeep()
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
      <StorageNotices />
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

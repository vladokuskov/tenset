import { Link, useLocation } from '@tanstack/react-router'
import { useMessages } from '../i18n/messages'
import { cx } from './cx'
import { uiMessages } from './messages'
import { NAV_ITEMS } from './nav'

/** Bottom tabs below 1280px. */
export function TabBar({ className }: { className?: string }) {
  const pathname = useLocation({ select: (l) => l.pathname })
  const m = useMessages(uiMessages)
  return (
    <nav
      aria-label={m.nav.main}
      className={cx('glass fixed inset-x-0 bottom-0 z-30 border-t border-line pb-safe desktop:hidden', className)}
    >
      <ul className="mx-auto flex h-[var(--tabbar-h)] max-w-[var(--page-max)] items-stretch px-2">
        {NAV_ITEMS.map(({ to, labelKey, icon: Icon, match }) => {
          const current = match.test(pathname)
          return (
            <li key={to} className="flex flex-1">
              <Link
                to={to}
                aria-current={current ? 'page' : undefined}
                className={cx(
                  'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-[0.6875rem] font-medium transition-colors',
                  current ? 'text-accent' : 'text-ink-3 hover:text-ink-2',
                )}
              >
                <Icon size={24} strokeWidth={current ? 2 : 1.6} aria-hidden />
                <span>{m.nav[labelKey]}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

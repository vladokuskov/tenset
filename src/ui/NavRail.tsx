import { Link, useLocation, type LinkProps } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMessages } from '../i18n/messages'
import { cx } from './cx'
import { LanguageToggle } from './LanguageToggle'
import { uiMessages } from './messages'
import { NAV_ITEMS } from './nav'

function RailLink({ to, label, icon, current }: { to: LinkProps['to']; label: string; icon: ReactNode; current: boolean }) {
  return (
    <Link
      to={to}
      aria-current={current ? 'page' : undefined}
      className={cx(
        'group flex flex-col items-center gap-1 py-1.5 text-xs font-medium transition-colors',
        current ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
      )}
    >
      <span
        className={cx(
          'flex h-9 w-14 items-center justify-center rounded-full transition-colors',
          current ? 'bg-accent-soft text-accent' : 'group-hover:bg-surface-2',
        )}
      >
        {icon}
      </span>
      {label}
    </Link>
  )
}

/** Left rail from 1280px up. */
export function NavRail({ brand }: { brand?: ReactNode }) {
  const pathname = useLocation({ select: (l) => l.pathname })
  const m = useMessages(uiMessages)
  return (
    <nav
      aria-label={m.nav.main}
      className="fixed inset-y-0 left-0 z-30 hidden w-[var(--rail-w)] flex-col items-center border-r border-line bg-canvas pb-5 pt-[max(1.25rem,var(--safe-top))] desktop:flex"
    >
      {brand && <div className="mb-6">{brand}</div>}
      <ul className="flex flex-col gap-3">
        {NAV_ITEMS.map(({ to, labelKey, icon: Icon, match }) => {
          const current = match.test(pathname)
          return (
            <li key={to}>
              <RailLink to={to} label={m.nav[labelKey]} current={current} icon={<Icon size={22} strokeWidth={current ? 2 : 1.6} aria-hidden />} />
            </li>
          )
        })}
      </ul>
      <div className="mt-auto flex flex-col items-center gap-3">
        <LanguageToggle className="[&_button]:px-1.5" />
        <RailLink
          to="/settings"
          label={m.nav.settings}
          current={pathname.startsWith('/settings')}
          icon={<Settings size={22} strokeWidth={1.6} aria-hidden />}
        />
      </div>
    </nav>
  )
}

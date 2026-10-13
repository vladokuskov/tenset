import { Link, useNavigate, useRouter, type LinkProps } from '@tanstack/react-router'
import { ChevronLeft, Settings } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMessages } from '../i18n/messages'
import { cx } from './cx'
import { uiMessages } from './messages'
import { iconButtonClass } from './styles'

export type BackTarget = {
  /** Where back goes when there is no in-app history (deep link, Home Screen launch). */
  to: LinkProps['to']
  /** Parent screen name shown next to the chevron, e.g. "Plan". */
  label: string
}

export function BackButton({ to, label, iconOnly, className }: BackTarget & { iconOnly?: boolean; className?: string }) {
  const router = useRouter()
  const navigate = useNavigate()
  const m = useMessages(uiMessages)
  return (
    <button
      type="button"
      onClick={() => {
        if (router.history.canGoBack()) router.history.back()
        else void navigate({ to, replace: true })
      }}
      className={cx(
        '-ml-2 inline-flex h-11 min-w-11 max-w-full items-center gap-0.5 rounded-full pl-1 pr-3 text-base font-medium text-ink transition-colors hover:bg-surface-2',
        className,
      )}
    >
      <ChevronLeft size={24} strokeWidth={1.75} aria-hidden className="shrink-0" />
      <span className={iconOnly ? 'sr-only' : 'truncate'}>{label}</span>
      <span className="sr-only">{m.back}</span>
    </button>
  )
}

export type PageHeaderProps = {
  title: ReactNode
  /** Plain text for the toolbar copy when `title` holds a control (the copy is aria-hidden). */
  compactTitle?: string
  subtitle?: ReactNode
  /** Pushed screens show a visible back button (Home Screen mode has no browser chrome). */
  back?: BackTarget & { className?: string }
  /** Trailing toolbar controls, usually IconButtons. */
  actions?: ReactNode
  /** Rendered under the title, e.g. day chips or a segmented control. */
  children?: ReactNode
  /** Top-level screens link to Settings from the toolbar (the desktop rail has its own link). */
  settings?: boolean
  className?: string
}

/**
 * Sticky translucent toolbar plus a large title that scrolls away; the title moves into the
 * toolbar once it is out of view so context is never lost.
 */
export function PageHeader({ title, compactTitle, subtitle, back, actions, children, settings, className }: PageHeaderProps) {
  const m = useMessages(uiMessages)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [compact, setCompact] = useState(false)

  useEffect(() => {
    const el = titleRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), {
      rootMargin: '-56px 0px 0px 0px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <>
      <div className="glass sticky top-0 z-30 pt-safe" data-compact={compact || undefined}>
        <div className="relative mx-auto flex h-13 w-full max-w-[var(--page-max)] items-center gap-2 px-gutter">
          <div className="flex min-w-0 flex-1 items-center">
            {back && <BackButton {...back} iconOnly={compact} />}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-1">
            {settings && (
              <Link to="/settings" aria-label={m.nav.settings} title={m.nav.settings} className={iconButtonClass({}, 'desktop:hidden')}>
                <Settings size={22} strokeWidth={1.75} aria-hidden />
              </Link>
            )}
            {actions}
          </div>
          <p
            aria-hidden
            className={cx(
              'pointer-events-none absolute inset-x-16 truncate text-center text-md font-semibold transition-opacity duration-200',
              compact ? 'opacity-100' : 'invisible opacity-0',
            )}
          >
            {compactTitle ?? title}
          </p>
        </div>
        <div
          className={cx(
            'h-px bg-line transition-opacity duration-200',
            compact ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>
      <header className={cx('mx-auto w-full max-w-[var(--page-max)] px-gutter pb-4 pt-1', className)}>
        <h1 ref={titleRef} tabIndex={-1} className="break-words hyphens-auto text-2xl font-bold tracking-[-0.022em] text-ink outline-none">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-base text-ink-2">{subtitle}</p>}
        {children && <div className="mt-4">{children}</div>}
      </header>
    </>
  )
}

import type { CSSProperties, ReactNode } from 'react'
import { cx } from './cx'

export type PageProps = {
  /** narrow: phone column, max 640px. wide: desktop layouts such as the week board. */
  width?: 'narrow' | 'wide'
  /** Exactly one screen tall: children share the height and scroll inside themselves (desktop week board). */
  fit?: boolean
  children: ReactNode
  className?: string
}

/** Screen wrapper: sets the content width and leaves room for the tab bar and sticky actions. */
export function Page({ width = 'narrow', fit, children, className }: PageProps) {
  const style = width === 'wide' ? ({ '--page-max': '90rem' } as CSSProperties) : undefined
  return (
    <div
      className={cx(fit ? 'flex h-dvh min-h-[36rem] flex-col pb-[calc(var(--chrome-bottom)+1rem)]' : 'min-h-dvh pb-chrome', className)}
      style={style}
      data-width={width}
    >
      {children}
    </div>
  )
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-[var(--page-max)] px-gutter', className)}>{children}</div>
}

/** Grouped surface on the canvas. Rows inside use hairline dividers, not nested cards. */
export function Panel({ children, className, as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'ul' }) {
  return <Tag className={cx('rounded-xl bg-surface', className)}>{children}</Tag>
}

export type SectionProps = {
  title: ReactNode
  description?: ReactNode
  /** Trailing control on the title row, e.g. a link button. */
  action?: ReactNode
  children: ReactNode
  className?: string
}

export function Section({ title, description, action, children, className }: SectionProps) {
  return (
    <section className={cx('mt-7 first:mt-0', className)}>
      <div className="mb-2.5 flex min-h-8 items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="text-md font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-2">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Fixed action bar above the tab bar, e.g. "Add exercise". Toasts move up to clear it. */
export function StickyActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-sticky-actions
      className="glass fixed inset-x-0 z-20 border-t border-line"
      style={{ bottom: 'var(--chrome-bottom)', left: 'var(--chrome-left)' }}
    >
      <div className={cx('mx-auto flex h-[4.75rem] w-full max-w-[var(--page-max)] items-center gap-3 px-gutter [&>*]:whitespace-normal', className)}>
        {children}
      </div>
    </div>
  )
}

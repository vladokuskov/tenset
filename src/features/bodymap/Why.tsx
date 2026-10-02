import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useLocale } from '../../i18n/messages'
import { cx } from '../../ui/cx'
import { bodymapMessages } from './messages'
import { citation } from './sources'

export type WhyProps = {
  /** What the popover explains, e.g. "Chest band"; also the button's accessible name suffix. */
  topic: string
  children?: ReactNode
  /** sourceIds from the engine; each is shown as a citation from data/sources.json. */
  sources: readonly string[]
  className?: string
}

const GAP = 6
const EDGE = 8

/** "why?" link that opens a small popover with the reasoning and its citations. */
export function Why({ topic, children, sources, className }: WhyProps) {
  const id = useId()
  const locale = useLocale()
  const m = bodymapMessages[locale]
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const pop = popRef.current
    const button = buttonRef.current
    if (!pop || !button) return
    const anchor = () => button.getBoundingClientRect()
    const onBeforeToggle = (e: Event) => {
      if ((e as ToggleEvent).newState !== 'open') return
      const a = anchor()
      const w = Math.min(320, window.innerWidth - 2 * EDGE)
      pop.style.width = `${w}px`
      pop.style.left = `${Math.max(EDGE, Math.min(window.innerWidth - w - EDGE, a.left - 12))}px`
      pop.style.top = `${a.bottom + GAP}px`
    }
    const hide = (e: Event) => {
      if (e.target instanceof Node && pop.contains(e.target)) return
      pop.hidePopover?.()
    }
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === 'open') {
        const a = anchor()
        const h = pop.offsetHeight
        if (a.bottom + GAP + h > window.innerHeight - EDGE) pop.style.top = `${Math.max(EDGE, a.top - GAP - h)}px`
        window.addEventListener('scroll', hide, { capture: true, passive: true })
        window.addEventListener('resize', hide)
      } else {
        window.removeEventListener('scroll', hide, { capture: true })
        window.removeEventListener('resize', hide)
      }
    }
    pop.addEventListener('beforetoggle', onBeforeToggle)
    pop.addEventListener('toggle', onToggle)
    return () => {
      pop.removeEventListener('beforetoggle', onBeforeToggle)
      pop.removeEventListener('toggle', onToggle)
      window.removeEventListener('scroll', hide, { capture: true })
      window.removeEventListener('resize', hide)
    }
  }, [])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={id}
        aria-label={m.whyLabel(topic)}
        className={cx(
          'hit inline-flex h-6 shrink-0 items-center rounded-full px-1.5 text-sm font-medium text-accent underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent',
          className,
        )}
      >
        {m.why}
      </button>
      <div
        ref={popRef}
        id={id}
        popover="auto"
        role="note"
        className="fixed inset-auto m-0 max-h-[60dvh] overflow-y-auto rounded-lg border border-line bg-raised p-4 text-left text-sm text-ink shadow-float"
      >
        {children && <div className="text-base leading-snug text-ink">{children}</div>}
        {sources.length > 0 && (
          <ul className={cx('space-y-2', children ? 'mt-3 border-t border-line pt-3' : '')}>
            {[...new Set(sources)].map((s) => {
              const c = citation(s, locale)
              return (
                <li key={s} className="text-xs leading-relaxed text-ink-2">
                  {c.note && <span className="mr-1 font-semibold text-ink">{c.note}:</span>}
                  {c.text}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}

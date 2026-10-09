import { Check, ChevronDown, Search } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useMessages } from '../i18n/messages'
import { cx } from './cx'
import { uiMessages } from './messages'

export type SelectOption<T extends string | number> = { value: T; label: string; hint?: string; lang?: string }
export type SelectGroup<T extends string | number> = { label?: string; options: readonly SelectOption<T>[] }

export type SelectProps<T extends string | number> = {
  /** Accessible name, also the title of the phone sheet. */
  label: string
  value: T | undefined
  groups: readonly SelectGroup<T>[]
  onChange: (value: T) => void
  /** chip: filter pill; field: form input; custom: the caller renders the trigger content. */
  variant?: 'chip' | 'field' | 'custom'
  /** Trigger text when nothing is selected. */
  placeholder?: string
  /** Whether the value counts as chosen: false shows the placeholder (e.g. an "any" choice) and an unfilled chip. */
  active?: boolean
  /** Trigger content for the custom variant. */
  children?: ReactNode
  className?: string
  /** Where the desktop menu opens relative to the trigger. */
  side?: 'bottom' | 'right'
  /** Shows a search field; on by default for long lists. */
  searchable?: boolean
}

const DESKTOP = '(min-width: 64rem)'
const GAP = 6
const EDGE = 12

/**
 * Listbox in a popover: a menu anchored to the trigger from 1024px up, a bottom sheet below that.
 * The popover sits in the top layer, so it also works inside an open Sheet.
 */
export function Select<T extends string | number>({
  label,
  value,
  groups,
  onChange,
  variant = 'chip',
  placeholder,
  active,
  children,
  className,
  side = 'bottom',
  searchable,
}: SelectProps<T>) {
  const m = useMessages(uiMessages)
  const popId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'menu' | 'sheet'>('menu')
  const [query, setQuery] = useState('')

  const all = groups.flatMap((g) => g.options)
  const current = all.find((o) => o.value === value)
  const shownValue = active === false ? undefined : current
  const withSearch = searchable ?? all.length > 12
  const q = query.trim().toLocaleLowerCase()
  const shown = groups
    .map((g) => ({ ...g, options: q ? g.options.filter((o) => o.label.toLocaleLowerCase().includes(q)) : g.options }))
    .filter((g) => g.options.length > 0)

  const options = () => [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]

  const show = () => {
    setMode(window.matchMedia(DESKTOP).matches ? 'menu' : 'sheet')
    setQuery('')
    popRef.current?.showPopover()
  }
  const hide = (refocus = true) => {
    if (popRef.current?.matches(':popover-open')) popRef.current.hidePopover()
    if (refocus) triggerRef.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    const pop = popRef.current
    if (!pop) return
    const onToggle = (e: Event) => {
      const opened = (e as ToggleEvent).newState === 'open'
      setOpen(opened)
      // Escape and light dismiss close it natively; bring focus back unless it moved somewhere else on purpose.
      const el = document.activeElement
      if (!opened && (el === document.body || pop.contains(el))) triggerRef.current?.focus({ preventScroll: true })
    }
    pop.addEventListener('toggle', onToggle)
    return () => pop.removeEventListener('toggle', onToggle)
  }, [])

  // Place the menu, then focus the current option so arrows and Enter work right away.
  useLayoutEffect(() => {
    const pop = popRef.current
    const trigger = triggerRef.current
    if (!open || !pop || !trigger) return
    if (mode === 'menu') {
      const r = trigger.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      pop.style.minWidth = `${Math.max(r.width, 192)}px`
      pop.style.maxHeight = ''
      const h = pop.offsetHeight
      const w = pop.offsetWidth
      let top: number
      let left: number
      if (side === 'right') {
        // Clear of the rail or panel the trigger sits in, not just the trigger.
        left = (trigger.closest('nav')?.getBoundingClientRect().right ?? r.right) + GAP
        top = Math.max(EDGE, Math.min(r.bottom - h, vh - h - EDGE))
      } else {
        const below = vh - r.bottom - GAP - EDGE
        const above = r.top - GAP - EDGE
        const up = h > below && above > below
        pop.style.maxHeight = `${Math.min(h, up ? above : below)}px`
        top = up ? r.top - GAP - Math.min(h, above) : r.bottom + GAP
        left = Math.max(EDGE, Math.min(r.left, vw - w - EDGE))
      }
      pop.style.top = `${top}px`
      pop.style.left = `${left}px`
    } else {
      pop.style.top = pop.style.left = pop.style.minWidth = pop.style.maxHeight = ''
    }
    const list = options()
    const target = list.find((o) => o.getAttribute('aria-selected') === 'true') ?? list[0]
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'nearest' })
  }, [open, mode, side])

  // A menu anchored to a moving trigger would drift, so scrolling or resizing the page closes it.
  useEffect(() => {
    if (!open || mode !== 'menu') return
    const onScroll = (e: Event) => {
      if (!popRef.current?.contains(e.target as Node)) hide(false)
    }
    const onResize = () => hide(false)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, mode])

  const pick = (v: T) => {
    hide()
    if (v !== value) onChange(v)
  }

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    show()
  }

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = options()
    const i = list.indexOf(document.activeElement as HTMLElement)
    let next: HTMLElement | undefined
    if (e.key === 'ArrowDown') next = i < 0 ? list[0] : list[Math.min(list.length - 1, i + 1)]
    else if (e.key === 'ArrowUp') next = i <= 0 ? (withSearch ? undefined : list[0]) : list[i - 1]
    else if (e.key === 'Home') next = list[0]
    else if (e.key === 'End') next = list[list.length - 1]
    else if (e.key === 'Tab') return hide(false)
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ' && document.activeElement !== searchRef.current) {
      if (withSearch) return searchRef.current?.focus()
      const now = Date.now()
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLocaleLowerCase(), at: now }
      next = list.find((o) => o.textContent?.toLocaleLowerCase().startsWith(typed.current.text))
    } else return
    if (e.key === 'ArrowUp' && i === 0 && withSearch) {
      e.preventDefault()
      searchRef.current?.focus()
      return
    }
    if (!next) return
    e.preventDefault()
    next.focus()
    next.scrollIntoView({ block: 'nearest' })
  }

  const text = shownValue?.label ?? placeholder ?? label
  const filled = variant === 'chip' && (active ?? Boolean(current))

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={popId}
        aria-label={shownValue ? `${label}: ${shownValue.label}` : label}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onTriggerKey}
        className={cx(
          variant === 'chip' &&
            cx(
              'hit inline-flex h-8 shrink-0 select-none items-center gap-1 rounded-full border px-3 text-sm font-medium transition-[background-color,border-color,color] duration-150',
              filled ? 'border-ink bg-ink text-on-ink' : 'border-line-strong text-ink hover:bg-surface-2',
            ),
          variant === 'field' &&
            'flex h-11 w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-raised pl-3.5 pr-3 text-left text-base text-ink transition-colors hover:border-ink-3 aria-expanded:border-ink',
          className,
        )}
      >
        {variant === 'custom' ? (
          children
        ) : (
          <>
            <span aria-hidden className={cx('truncate', variant === 'field' && !shownValue && 'text-ink-3')} lang={shownValue?.lang}>
              {text}
            </span>
            <ChevronDown
              size={variant === 'field' ? 16 : 14}
              strokeWidth={2}
              aria-hidden
              className={cx('shrink-0 transition-transform duration-150', open && 'rotate-180', filled ? 'text-on-ink/70' : 'text-ink-3')}
            />
          </>
        )}
      </button>
      <div
        ref={popRef}
        id={popId}
        popover="auto"
        data-mode={mode}
        className="select-pop"
        onClick={(e) => {
          if (e.target === e.currentTarget) hide()
        }}
      >
        {open && (
          <div className="flex max-h-[inherit] min-h-0 flex-col" onKeyDown={onListKey}>
            {mode === 'sheet' && (
              <>
                <div className="flex shrink-0 justify-center pt-2" aria-hidden>
                  <span className="h-1 w-9 rounded-full bg-line-strong" />
                </div>
                <p className="shrink-0 px-5 pb-2 pt-3 text-lg font-semibold tracking-[-0.01em]">
                  {label}
                </p>
              </>
            )}
            {withSearch && (
              <label className={cx('block shrink-0', mode === 'sheet' ? 'px-4 pb-2' : 'p-1 pb-0')}>
                <span className="sr-only">{m.search}</span>
                <span className="relative block">
                  <Search size={16} strokeWidth={1.75} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={m.search}
                    autoComplete="off"
                    aria-controls={`${popId}-list`}
                    className="h-10 w-full rounded-md bg-surface-2 pl-8 pr-3 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-2 [&::-webkit-search-cancel-button]:hidden"
                  />
                </span>
              </label>
            )}
            <div
              ref={listRef}
              id={`${popId}-list`}
              role="listbox"
              aria-label={label}
              className={cx('min-h-0 flex-1 overflow-y-auto overscroll-contain', mode === 'sheet' ? 'px-3 pb-[max(0.75rem,var(--safe-bottom))]' : 'p-1')}
            >
              {shown.length === 0 && <p className="px-3 py-3 text-sm text-ink-3">{m.noMatches}</p>}
              {shown.map((g, gi) => (
                <div key={gi} role={g.label ? 'group' : undefined} aria-label={g.label || undefined}>
                  {gi > 0 && !g.label && <div aria-hidden className="mx-2 my-1 h-px bg-line" />}
                  {g.label && (
                    <div aria-hidden className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-[0.06em] text-ink-3">
                      {g.label}
                    </div>
                  )}
                  {g.options.map((o) => {
                    const selected = o.value === value
                    return (
                      <button
                        key={o.value}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        aria-selected={selected}
                        lang={o.lang}
                        onClick={() => pick(o.value)}
                        className={cx(
                          'flex w-full items-center gap-3 rounded-sm px-3 text-left text-ink outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2',
                          mode === 'sheet' ? 'min-h-12 text-base' : 'min-h-10 text-sm',
                        )}
                      >
                        <span className="min-w-0 flex-1 py-2">
                          <span className={cx('block', selected ? 'font-semibold' : 'font-medium')}>{o.label}</span>
                          {o.hint && <span className="block text-xs text-ink-3">{o.hint}</span>}
                        </span>
                        <Check size={16} strokeWidth={2.4} aria-hidden className={cx('shrink-0', !selected && 'invisible')} />
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'

export type Segment<T extends string> = { value: T; label: ReactNode; disabled?: boolean }

export type SegmentedControlProps<T extends string> = {
  /** Accessible group name. */
  label: string
  options: readonly Segment<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  block?: boolean
  /** Equal-width segments regardless of label length. */
  equal?: boolean
  className?: string
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
  block,
  equal,
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = options.findIndex((o) => o.value === value)
    const pos = enabled.indexOf(current)
    let next: number | undefined
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(pos + 1) % enabled.length]
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = enabled[(pos - 1 + enabled.length) % enabled.length]
    else if (e.key === 'Home') next = enabled[0]
    else if (e.key === 'End') next = enabled[enabled.length - 1]
    if (next === undefined) return
    e.preventDefault()
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={equal ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
      className={cx(
        'rounded-md bg-surface-2 p-0.5',
        equal ? (block ? 'grid w-full' : 'inline-grid') : block ? 'flex w-full' : 'inline-flex',
        size === 'md' ? 'h-11' : 'h-9',
        className,
      )}
    >
      {options.map((o, i) => {
        const checked = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              // Each segment carries its own 44px hit area; one on the group would sit over the segments and swallow taps.
              'hit flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-md)-2px)] px-3 text-center font-medium leading-tight transition-[background-color,color,box-shadow] duration-150',
              size === 'md' ? 'text-sm' : 'text-xs',
              checked ? 'bg-thumb text-ink shadow-thumb' : 'text-ink-2 hover:text-ink',
              'disabled:opacity-40',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

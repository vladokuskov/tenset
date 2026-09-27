import { X } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

export type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  /** When defined the chip is a toggle and exposes aria-pressed. */
  selected?: boolean
  count?: number
  /** Renders a trailing remove affordance and labels the chip for removal. */
  onRemove?: () => void
  size?: 'sm' | 'md'
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected, count, onRemove, size = 'md', className, children, type = 'button', onClick, ...rest },
  ref,
) {
  const removable = Boolean(onRemove)
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected === undefined || removable ? undefined : selected}
      onClick={removable ? () => onRemove?.() : onClick}
      className={cx(
        'hit inline-flex shrink-0 select-none items-center gap-1.5 rounded-full border font-medium transition-[background-color,border-color,color] duration-150',
        size === 'md' ? 'h-9 px-3.5 text-sm' : 'h-8 px-3 text-sm',
        selected
          ? 'border-ink bg-ink text-on-ink'
          : 'border-line-strong bg-transparent text-ink hover:bg-surface-2',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
      {count !== undefined && <span className={cx('num', selected ? 'text-on-ink/70' : 'text-ink-3')}>{count}</span>}
      {removable && <X size={14} strokeWidth={2} aria-hidden className="-mr-1" />}
    </button>
  )
})

export type ChipOption<T extends string | number> = {
  value: T
  label: ReactNode
  count?: number
  disabled?: boolean
}

type Common<T extends string | number> = {
  /** Accessible group name. */
  label: string
  options: readonly ChipOption<T>[]
  /** One horizontally scrolling row instead of wrapping. */
  scroll?: boolean
  size?: 'sm' | 'md'
  className?: string
}

type Single<T extends string | number> = Common<T> & {
  multiple?: false
  value: T | null
  onChange: (value: T | null) => void
  /** Tapping the selected chip clears it. */
  allowEmpty?: boolean
}

type Multiple<T extends string | number> = Common<T> & {
  multiple: true
  value: readonly T[]
  onChange: (value: T[]) => void
}

export type ChipGroupProps<T extends string | number> = Single<T> | Multiple<T>

export function ChipGroup<T extends string | number>(props: ChipGroupProps<T>) {
  const { label, options, scroll, size, className } = props
  const isSelected = (v: T) => (props.multiple ? props.value.includes(v) : props.value === v)

  const toggle = (v: T) => {
    if (props.multiple) {
      const next = props.value.includes(v) ? props.value.filter((x) => x !== v) : [...props.value, v]
      props.onChange(options.map((o) => o.value).filter((x) => next.includes(x)))
    } else if (props.value === v) {
      if (props.allowEmpty) props.onChange(null)
    } else {
      props.onChange(v)
    }
  }

  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        'flex gap-2',
        scroll ? 'scrollbar-none -mx-4 overflow-x-auto px-4 py-1' : 'flex-wrap',
        className,
      )}
    >
      {options.map((o) => (
        <Chip
          key={String(o.value)}
          size={size}
          selected={isSelected(o.value)}
          count={o.count}
          disabled={o.disabled}
          onClick={() => toggle(o.value)}
        >
          {o.label}
        </Chip>
      ))}
    </div>
  )
}

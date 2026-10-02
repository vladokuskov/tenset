import { Minus, Plus } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useMessages } from '../i18n/messages'
import { cx } from './cx'
import { uiMessages } from './messages'

export type StepperProps = {
  value: number
  onChange: (value: number) => void
  /** Accessible name, e.g. "Sets for Incline dumbbell press". */
  label: string
  min?: number
  max?: number
  step?: number
  /** Short unit shown after the number, e.g. "sets". */
  unit?: string
  /** Screen reader text for the value, e.g. (v) => `${v} sets`. */
  valueText?: (value: number) => string
  decrementLabel?: string
  incrementLabel?: string
  disabled?: boolean
  className?: string
}

export function Stepper({
  value,
  onChange,
  label,
  min = 1,
  max = 20,
  step = 1,
  unit,
  valueText,
  decrementLabel,
  incrementLabel,
  disabled,
  className,
}: StepperProps) {
  const m = useMessages(uiMessages)
  const set = (v: number) => {
    const next = Math.min(max, Math.max(min, v))
    if (next !== value) onChange(next)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const map: Record<string, number> = {
      ArrowUp: value + step,
      ArrowRight: value + step,
      ArrowDown: value - step,
      ArrowLeft: value - step,
      PageUp: value + step * 5,
      PageDown: value - step * 5,
      Home: min,
      End: max,
    }
    if (!(e.key in map)) return
    e.preventDefault()
    set(map[e.key])
  }

  const btn =
    'hit flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink transition-[background-color,scale] duration-150 hover:bg-line active:scale-90 disabled:pointer-events-none disabled:opacity-35'

  return (
    <div role="group" aria-label={label} className={cx('inline-flex items-center gap-1', className)}>
      <button
        type="button"
        className={btn}
        aria-label={decrementLabel ?? m.decrease}
        disabled={disabled || value <= min}
        onClick={() => set(value - step)}
      >
        <Minus size={16} strokeWidth={2} aria-hidden />
      </button>
      <div
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={valueText?.(value)}
        aria-disabled={disabled || undefined}
        onKeyDown={disabled ? undefined : onKeyDown}
        className="num flex min-w-10 flex-col items-center justify-center rounded-sm px-1 leading-none"
      >
        <span className="text-md font-semibold">{value}</span>
        {unit && <span className="mt-0.5 text-[0.6875rem] text-ink-3">{unit}</span>}
      </div>
      <button
        type="button"
        className={btn}
        aria-label={incrementLabel ?? m.increase}
        disabled={disabled || value >= max}
        onClick={() => set(value + step)}
      >
        <Plus size={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  )
}

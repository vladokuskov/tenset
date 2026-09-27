import { dayName, sortDays, weekOrder, type DayIndex } from '../../app/days'
import { usePrefsStore } from '../../store/prefs.store'
import { cx } from '../../ui/cx'

export type DayPickerProps = {
  value: readonly DayIndex[]
  /** Called with unique days sorted Monday first (stored order). */
  onChange: (days: DayIndex[]) => void
  /** Accessible group name, e.g. "Add to days". */
  label: string
  /** Defaults to the user's week start. */
  weekStart?: DayIndex
  /** Short text under a day, e.g. "Rest" or "4". */
  hints?: Partial<Record<DayIndex, string>>
  disabled?: readonly DayIndex[]
  className?: string
}

/** Multi-select Mon..Sun toggles in the user's week order. */
export function DayPicker({ value, onChange, label, weekStart, hints, disabled, className }: DayPickerProps) {
  const prefStart = usePrefsStore((s) => s.weekStart)
  const start = weekStart ?? prefStart
  const toggle = (d: DayIndex) => {
    const next = value.includes(d) ? value.filter((x) => x !== d) : [...value, d]
    onChange(sortDays(next, 0))
  }
  return (
    <div role="group" aria-label={label} className={cx('grid grid-cols-7 gap-1.5', className)}>
      {weekOrder(start).map((d) => {
        const selected = value.includes(d)
        const hint = hints?.[d]
        return (
          <button
            key={d}
            type="button"
            aria-pressed={selected}
            aria-label={hint ? `${dayName(d, 'long')}, ${hint}` : dayName(d, 'long')}
            disabled={disabled?.includes(d)}
            onClick={() => toggle(d)}
            className={cx(
              'flex h-14 min-w-0 flex-col items-center justify-center rounded-md border text-sm font-medium transition-[background-color,border-color,color] duration-150 active:scale-95 disabled:opacity-35',
              selected ? 'border-ink bg-ink text-on-ink' : 'border-line-strong text-ink hover:bg-surface-2',
            )}
          >
            <span>{dayName(d)}</span>
            {hint && (
              <span
                className={cx('mt-0.5 max-w-full truncate px-0.5 text-[0.6875rem] font-normal', selected ? 'text-on-ink/70' : 'text-ink-3')}
              >
                {hint}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

import { dayName, sortDays, weekOrder, type DayIndex } from '../../app/days'
import { useLocale } from '../../i18n/messages'
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
  const locale = useLocale()
  const toggle = (d: DayIndex) => {
    const next = value.includes(d) ? value.filter((x) => x !== d) : [...value, d]
    onChange(sortDays(next, 0))
  }
  return (
    <div className={cx('@container', className)}>
      <div role="group" aria-label={label} className="grid grid-cols-7 gap-1.5 @max-3xs:grid-cols-4">
        {weekOrder(start).map((d) => {
          const selected = value.includes(d)
          const hint = hints?.[d]
          return (
            <button
              key={d}
              type="button"
              aria-pressed={selected}
              aria-label={hint ? `${dayName(d, 'long', locale)}, ${hint}` : dayName(d, 'long', locale)}
              disabled={disabled?.includes(d)}
              onClick={() => toggle(d)}
              className={cx(
                'flex min-h-14 min-w-0 flex-col items-center justify-center rounded-md border py-1 text-sm font-medium transition-[background-color,border-color,color] duration-150 active:scale-95 disabled:opacity-35',
                selected ? 'border-ink bg-ink text-on-ink' : 'border-line-strong text-ink hover:bg-surface-2',
              )}
            >
              <span>{dayName(d, 'short', locale)}</span>
              {hint && (
                <span
                  className={cx('mt-0.5 line-clamp-2 max-w-full break-words px-0.5 text-center text-[0.6875rem] font-normal leading-tight', selected ? 'text-on-ink/70' : 'text-ink-3')}
                >
                  {hint}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

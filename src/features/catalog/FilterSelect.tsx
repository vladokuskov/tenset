import { ChevronDown } from 'lucide-react'
import { useId } from 'react'
import { useMessages } from '../../i18n/messages'
import { cx } from '../../ui/cx'
import { catalogMessages } from './messages'

export type FilterSelectGroup = { label: string; options: readonly { value: string; label: string }[] }

/** Chip-styled native select: the platform picker on phones, a plain menu on desktop. The invisible select is the 44px hit area. */
export function FilterSelect({
  label,
  placeholder,
  anyLabel,
  value,
  groups,
  onChange,
}: {
  label: string
  /** Chip text when nothing is selected, e.g. "Pattern". */
  placeholder: string
  /** First option, e.g. "Any pattern"; defaults to a generic form built from the placeholder. */
  anyLabel?: string
  value: string | undefined
  groups: readonly FilterSelectGroup[]
  onChange: (value: string | undefined) => void
}) {
  const id = useId()
  const m = useMessages(catalogMessages)
  const current = groups.flatMap((g) => g.options).find((o) => o.value === value)
  const selected = Boolean(current)
  return (
    <span
      className={cx(
        'relative inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-sm font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent',
        selected ? 'border-ink bg-ink text-on-ink' : 'border-line-strong text-ink',
      )}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span aria-hidden>{current?.label ?? placeholder}</span>
      <ChevronDown size={14} strokeWidth={2} aria-hidden className={selected ? 'text-on-ink/70' : 'text-ink-3'} />
      <select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="absolute inset-x-0 -inset-y-[7px] cursor-pointer appearance-none opacity-0"
      >
        <option value="">{anyLabel ?? m.anyOf(placeholder)}</option>
        {groups.map((g) =>
          g.label ? (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : (
            g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          ),
        )}
      </select>
    </span>
  )
}

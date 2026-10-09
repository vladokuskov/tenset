import { useMessages } from '../../i18n/messages'
import { Select } from '../../ui'
import { catalogMessages } from './messages'

export type FilterSelectGroup = { label: string; options: readonly { value: string; label: string }[] }

const ANY = ''

/** Filter chip with a menu of choices; the first choice clears the filter. */
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
  const m = useMessages(catalogMessages)
  return (
    <Select
      label={label}
      placeholder={placeholder}
      value={value ?? ANY}
      active={value !== undefined}
      groups={[{ options: [{ value: ANY, label: anyLabel ?? m.anyOf(placeholder) }] }, ...groups]}
      onChange={(v) => onChange(v || undefined)}
    />
  )
}

import { ChevronDown } from 'lucide-react'
import { Chip, Sheet, useSheet } from '../../ui'
import { useMessages } from '../../i18n/messages'
import { catalogMessages } from './messages'

import type { FilterSelectGroup } from './FilterSelect'

/** Filter chip that opens a sheet of choices, like the muscle filter. The sheet lives in the URL. */
export function FilterSheet({
  sheet,
  label,
  placeholder,
  anyLabel,
  value,
  groups,
  onChange,
}: {
  /** Name of the sheet in the route's `sheet` search enum. */
  sheet: string
  label: string
  /** Chip text when nothing is selected, e.g. "Movement". */
  placeholder: string
  /** First choice, e.g. "Any movement"; defaults to a generic form built from the placeholder. */
  anyLabel?: string
  value: string | undefined
  groups: readonly FilterSelectGroup[]
  /** Called with the new value; the caller also closes the sheet (in the same navigation). */
  onChange: (value: string | undefined) => void
}) {
  const control = useSheet(sheet)
  const m = useMessages(catalogMessages)
  const current = groups.flatMap((g) => g.options).find((o) => o.value === value)
  return (
    <>
      <Chip size="sm" selected={Boolean(current)} aria-haspopup="dialog" aria-label={current ? `${label}: ${current.label}` : label} onClick={() => control.show()}>
        {current?.label ?? placeholder}
        <ChevronDown size={14} strokeWidth={2} aria-hidden className={current ? 'text-on-ink/70' : 'text-ink-3'} />
      </Chip>
      <Sheet open={control.open} onClose={control.close} title={label} desktop="center">
        <div className="flex flex-wrap gap-2">
          <Chip size="sm" selected={!current} onClick={() => onChange(undefined)}>
            {anyLabel ?? m.anyOf(placeholder)}
          </Chip>
        </div>
        {groups.map((g, i) => (
          <section key={g.label || i} className="mt-5">
            {g.label && <h3 className="mb-2 px-1 text-sm font-semibold text-ink-2">{g.label}</h3>}
            <div className="flex flex-wrap gap-2">
              {g.options.map((o) => (
                <Chip key={o.value} size="sm" selected={o.value === value} onClick={() => onChange(o.value === value ? undefined : o.value)}>
                  {o.label}
                </Chip>
              ))}
            </div>
          </section>
        ))}
      </Sheet>
    </>
  )
}

import { Check } from 'lucide-react'
import { equipment } from '../../domain/equipment'
import { cx } from '../../ui'

/** Every equipment item as a checkbox row. Nothing checked means bodyweight only. */
export function EquipmentChecklist({
  value,
  onChange,
  className,
}: {
  value: readonly string[]
  onChange: (next: string[]) => void
  className?: string
}) {
  const selected = new Set(value)
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(equipment.map((e) => e.id).filter((e) => next.has(e)))
  }
  return (
    <fieldset className={className}>
      <legend className="sr-only">Equipment you can use</legend>
      <ul className="divide-y divide-line rounded-xl bg-surface">
        {equipment.map((e) => {
          const on = selected.has(e.id)
          return (
            <li key={e.id}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2">
                <input type="checkbox" checked={on} onChange={() => toggle(e.id)} className="peer sr-only" />
                <span
                  aria-hidden
                  className={cx(
                    'flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
                    on ? 'border-ink bg-ink text-on-ink' : 'border-line-strong',
                  )}
                >
                  {on && <Check size={14} strokeWidth={2.5} />}
                </span>
                <span className="text-base">{e.name}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}

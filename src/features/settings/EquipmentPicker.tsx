import { Check, ChevronDown, Minus } from 'lucide-react'
import { useState } from 'react'
import { gapNote } from '../../app/knownGaps'
import { equipmentGroupName, equipmentName, presetName } from '../../data/localize'
import {
  equipment,
  equipmentGroups,
  groupState,
  matchPreset,
  presetEquipment,
  presets,
  type EquipmentGroup,
} from '../../domain/equipment'
import { useLocale, useMessages } from '../../i18n/messages'
import { useActiveProgram } from '../../store/program.store'
import { cx } from '../../ui'
import { equipmentSummary } from './equipmentSummary'
import { ActiveProgramSwap } from './EquipmentSwap'
import { settingsMessages } from './messages'

const box = (on: boolean) =>
  cx(
    'flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
    on ? 'border-ink bg-ink text-on-ink' : 'border-line-strong',
  )

/** Presets as starting points, then items grouped by kind. Nothing checked means bodyweight only. */
export function EquipmentPicker({
  value,
  onChange,
  className,
}: {
  value: readonly string[]
  onChange: (next: string[]) => void
  className?: string
}) {
  const m = useMessages(settingsMessages)
  const locale = useLocale()
  const program = useActiveProgram()
  const selected = new Set(value)
  const preset = matchPreset(value)
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(equipmentGroups.filter((g) => groupState(g, selected) === 'some').map((g) => g.id)),
  )
  const gaps = gapNote(value)

  const commit = (next: Set<string>) => onChange(equipment.map((e) => e.id).filter((e) => next.has(e)))
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    commit(next)
  }
  const toggleGroup = (g: EquipmentGroup) => {
    const next = new Set(selected)
    const add = groupState(g, selected) !== 'all'
    for (const e of g.items) {
      if (add) next.add(e.id)
      else next.delete(e.id)
    }
    commit(next)
  }
  const toggleOpen = (id: string) => {
    const next = new Set(open)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setOpen(next)
  }

  return (
    <div className={className}>
      <ul className="space-y-2" role="radiogroup" aria-label={m.presetGroup}>
        {presets.map((p) => {
          const on = preset === p.id
          return (
            <li key={p.id}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(presetEquipment(p.id))}
                className={cx(
                  'flex min-h-14 w-full items-center gap-3 rounded-xl border-2 bg-surface px-4 text-left transition-colors',
                  on ? 'border-ink' : 'border-transparent hover:border-line-strong',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-medium">{presetName(p.id, locale)}</span>
                  <span className="num block text-sm text-ink-2">
                    {p.equipment.length === 0 ? m.noEquipment : m.itemsOf(p.equipment.length, equipment.length)}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cx('size-5 shrink-0 rounded-full border-2', on ? 'border-ink bg-ink ring-4 ring-surface ring-inset' : 'border-line-strong')}
                />
              </button>
            </li>
          )
        })}
      </ul>

      <div className="mt-6 flex items-baseline justify-between gap-3">
        <h3 className="text-base font-medium">{m.adjustItems}</h3>
        <p className="num text-sm text-ink-2" aria-live="polite">
          {preset ? m.itemsOf(value.length, equipment.length) : equipmentSummary(value, locale)}
        </p>
      </div>

      <fieldset className="mt-2">
        <legend className="sr-only">{m.equipmentYouCanUse}</legend>
        <ul className="divide-y divide-line rounded-xl bg-surface">
          {equipmentGroups.map((g) => {
            const state = groupState(g, selected)
            const expanded = open.has(g.id)
            const count = g.items.filter((e) => selected.has(e.id)).length
            return (
              <li key={g.id}>
                <div className="flex min-h-14 items-center">
                  <label className="flex cursor-pointer items-center py-2 pr-2 pl-4">
                    <input
                      type="checkbox"
                      checked={state === 'all'}
                      ref={(el) => {
                        if (el) el.indeterminate = state === 'some'
                      }}
                      onChange={() => toggleGroup(g)}
                      aria-label={m.allOf(equipmentGroupName(g.id, locale))}
                      className="peer sr-only"
                    />
                    <span aria-hidden className={box(state !== 'none')}>
                      {state === 'all' && <Check size={14} strokeWidth={2.5} />}
                      {state === 'some' && <Minus size={14} strokeWidth={2.5} />}
                    </span>
                  </label>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`equip-${g.id}`}
                    onClick={() => toggleOpen(g.id)}
                    className="flex min-h-14 flex-1 items-center gap-3 py-2 pr-4 pl-1 text-left"
                  >
                    <span className="min-w-0 flex-1 text-base font-medium">{equipmentGroupName(g.id, locale)}</span>
                    <span className="num text-sm text-ink-2">
                      {m.countOf(count, g.items.length)}
                    </span>
                    <ChevronDown aria-hidden size={18} className={cx('shrink-0 text-ink-3 transition-transform', expanded && 'rotate-180')} />
                  </button>
                </div>
                {expanded && (
                  <ul id={`equip-${g.id}`} className="divide-y divide-line border-t border-line">
                    {g.items.map((e) => {
                      const on = selected.has(e.id)
                      return (
                        <li key={e.id}>
                          <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2 pr-4 pl-12">
                            <input type="checkbox" checked={on} onChange={() => toggle(e.id)} className="peer sr-only" />
                            <span aria-hidden className={box(on)}>
                              {on && <Check size={14} strokeWidth={2.5} />}
                            </span>
                            <span className="text-base">{equipmentName(e.id, locale)}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </fieldset>

      {value.length === 0 && <p className="mt-4 text-sm text-ink-2">{m.nothingSelected}</p>}
      {gaps && <p className="mt-4 text-sm text-ink-2">{gaps}</p>}
      {program && <ActiveProgramSwap program={program} available={value} className="mt-4" />}
    </div>
  )
}

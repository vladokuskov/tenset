import { useMemo, useState } from 'react'
import { groupName } from '../../data/localize'
import type { Exercise, Role } from '../../domain/schema'
import { groups } from '../../domain/taxonomy'
import { common } from '../../i18n/common'
import { useLocale } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { Button } from '../../ui/Button'
import { Pill } from '../../ui/Pill'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Sheet } from '../../ui/Sheet'
import { showToast } from '../../ui/toast'
import { catalogMessages } from './messages'
import { applyOverride, isCustomized } from './roles'

type Choice = Role | 'none'

const CHOICES = ['primary', 'secondary', 'none'] as const
const AREAS = ['upper', 'core', 'lower'] as const

/** Per-exercise group roles, stored in prefs.overrides and applied in every program. */
export function CountsSheet({ exercise, open, onClose }: { exercise: Exercise; open: boolean; onClose: () => void }) {
  const key = String(exercise.id)
  const locale = useLocale()
  const m = catalogMessages[locale]
  const choices = useMemo(
    () => CHOICES.map((value) => ({ value, label: catalogMessages[locale].choice[value] })),
    [locale],
  )
  const override = usePrefsStore((s) => s.overrides[key])
  const setOverride = usePrefsStore((s) => s.setOverride)
  const resetOverrides = usePrefsStore((s) => s.resetOverrides)
  const [added, setAdded] = useState<string[]>([])
  const roles = applyOverride(exercise.groups, override)
  const customized = isCustomized(exercise.groups, override)

  const rows = [
    ...Object.keys(exercise.groups).sort((a, b) => Number(exercise.groups[a] === 'secondary') - Number(exercise.groups[b] === 'secondary')),
    ...Object.keys(override ?? {}).filter((g) => !(g in exercise.groups)),
    ...added,
  ].filter((g, i, all) => all.indexOf(g) === i)

  const change = (group: string, value: Choice) => {
    const base: Choice = exercise.groups[group] ?? 'none'
    setOverride(exercise.id, group, value === base ? null : value)
  }

  const remaining = groups.filter((g) => !rows.includes(g.id))

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={m.editCounts}
      description={m.countsDescription(exercise.name)}
      headerEnd={customized ? <Pill variant="soft" className="mt-3.5">{m.custom}</Pill> : undefined}
      footer={
        <div className="flex gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={!override}
            onClick={() => {
              resetOverrides(exercise.id)
              setAdded([])
              showToast({ message: m.countsReset(exercise.name) })
            }}
          >
            {m.resetDefault}
          </Button>
          <Button variant="primary" className="flex-1" onClick={onClose}>
            {common[locale].done}
          </Button>
        </div>
      }
    >
      <ul className="divide-y divide-line">
        {rows.map((g) => {
          const value: Choice = roles[g] ?? 'none'
          const base: Choice = exercise.groups[g] ?? 'none'
          const name = groupName(g, locale)
          return (
            <li key={g} className="py-3">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="font-medium">{name}</span>
                <span className="text-sm text-ink-3">{value === base ? m.isDefault : m.defaultWas(base)}</span>
              </div>
              <SegmentedControl
                label={m.roleOf(name)}
                block
                options={choices}
                value={value}
                onChange={(v) => change(g, v)}
              />
            </li>
          )
        })}
      </ul>

      {remaining.length > 0 && (
        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">{m.addMuscle}</span>
          <select
            value=""
            onChange={(e) => {
              const g = e.target.value
              if (!g) return
              setAdded((a) => [...a, g])
              setOverride(exercise.id, g, 'secondary')
            }}
            className="h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-ink"
          >
            <option value="">{m.chooseGroup}</option>
            {AREAS.map((area) => (
              <optgroup key={area} label={m.area[area]}>
                {remaining
                  .filter((g) => g.area === area)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {groupName(g.id, locale)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}

      <p className="mt-5 text-sm text-ink-2">{m.countsNote}</p>
    </Sheet>
  )
}

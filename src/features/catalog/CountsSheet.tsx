import { useState } from 'react'
import type { Exercise, Role } from '../../domain/schema'
import { getGroup, groups } from '../../domain/taxonomy'
import { usePrefsStore } from '../../store/prefs.store'
import { Button } from '../../ui/Button'
import { Pill } from '../../ui/Pill'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Sheet } from '../../ui/Sheet'
import { showToast } from '../../ui/toast'
import { applyOverride, isCustomized } from './roles'

type Choice = Role | 'none'

const CHOICES = [
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'none', label: 'None' },
] as const

const AREAS = [
  { id: 'upper', label: 'Upper body' },
  { id: 'core', label: 'Core' },
  { id: 'lower', label: 'Lower body' },
] as const

const roleWord = (r: Choice) => (r === 'none' ? 'not counted' : r)

/** Per-exercise group roles, stored in prefs.overrides and applied in every program. */
export function CountsSheet({ exercise, open, onClose }: { exercise: Exercise; open: boolean; onClose: () => void }) {
  const key = String(exercise.id)
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
      title="Edit how this counts"
      description={`Changes how ${exercise.name} counts toward weekly sets in all your programs, on this device only.`}
      headerEnd={customized ? <Pill variant="soft" className="mt-3.5">custom</Pill> : undefined}
      footer={
        <div className="flex gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={!override}
            onClick={() => {
              resetOverrides(exercise.id)
              setAdded([])
              showToast({ message: `${exercise.name} counts as default again` })
            }}
          >
            Reset to default
          </Button>
          <Button variant="primary" className="flex-1" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <ul className="divide-y divide-line">
        {rows.map((g) => {
          const value: Choice = roles[g] ?? 'none'
          const base: Choice = exercise.groups[g] ?? 'none'
          const name = getGroup(g)?.name ?? g
          return (
            <li key={g} className="py-3">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="font-medium">{name}</span>
                <span className="text-sm text-ink-3">{value === base ? 'default' : `default: ${roleWord(base)}`}</span>
              </div>
              <SegmentedControl
                label={`${name} role`}
                block
                options={CHOICES}
                value={value}
                onChange={(v) => change(g, v)}
              />
            </li>
          )
        })}
      </ul>

      {remaining.length > 0 && (
        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">Add a muscle</span>
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
            <option value="">Choose a muscle group</option>
            {AREAS.map((area) => (
              <optgroup key={area.id} label={area.label}>
                {remaining
                  .filter((g) => g.area === area.id)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}

      <p className="mt-5 text-sm text-ink-2">
        Primary muscles count each set as 1, secondary as 0.5. Only the muscle groups change here; which heads light up
        inside a group stays as mapped.
      </p>
    </Sheet>
  )
}

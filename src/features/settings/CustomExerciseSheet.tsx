import { useState } from 'react'
import { equipmentName, groupName } from '../../data/localize'
import { equipment } from '../../domain/equipment'
import { MAX_CUSTOM, NAME_MAX } from '../../domain/program'
import type { CustomExercise, Role } from '../../domain/schema'
import { groups as allGroups } from '../../domain/taxonomy'
import { useLocale, useMessages } from '../../i18n/messages'
import { useActiveProgram, useProgramStore } from '../../store/program.store'
import { Button, ChipGroup, SegmentedControl, Sheet } from '../../ui'
import { BodyMap } from '../bodymap'
import { useChange } from '../shared/useChange'
import { settingsMessages } from './messages'

type Laterality = CustomExercise['laterality']
type RoleChoice = Role | 'off'

const AREAS = ['upper', 'core', 'lower'] as const

const NEXT: Record<RoleChoice, RoleChoice> = { off: 'primary', primary: 'secondary', secondary: 'off' }

// The map shades by sets; these stand-ins make primary read darker than secondary on every group's scale.
const MAP_SETS: Record<Role, number> = { primary: 18, secondary: 3 }

/** Create or edit one custom exercise of the active program. `id` is "new" or an existing custom id. */
export function CustomExerciseSheet({
  id,
  open,
  onClose,
  initialName = '',
}: {
  id: string | undefined
  open: boolean
  onClose: () => void
  /** Prefills the name of a new exercise, e.g. from a search with no match. */
  initialName?: string
}) {
  const program = useActiveProgram()
  const store = useProgramStore((s) => s)
  const change = useChange()
  const m = useMessages(settingsMessages)
  const locale = useLocale()
  const existing = id && id !== 'new' ? program?.custom.find((c) => c.id === id) : undefined

  const [name, setName] = useState('')
  const [equip, setEquip] = useState<string[]>([])
  const [laterality, setLaterality] = useState<Laterality>('bilateral')
  const [roles, setRoles] = useState<Record<string, Role>>({})
  const [mapView, setMapView] = useState<'front' | 'back'>('front')
  const [key, setKey] = useState<string | null>(null)
  const openKey = open ? (existing?.id ?? 'new') : null
  if (openKey !== key) {
    setKey(openKey)
    if (openKey) {
      setName(existing?.name ?? initialName.slice(0, NAME_MAX))
      setEquip(existing ? [...existing.equipment] : [])
      setLaterality(existing?.laterality ?? 'bilateral')
      setRoles(existing ? { ...existing.groups } : {})
      setMapView('front')
    }
  }

  const setRole = (group: string, choice: RoleChoice) => {
    setRoles((r) => {
      const { [group]: _drop, ...rest } = r
      return choice === 'off' ? rest : { ...rest, [group]: choice }
    })
  }
  const hasPrimary = Object.values(roles).includes('primary')
  const full = !existing && (program?.custom.length ?? 0) >= MAX_CUSTOM
  const canSave = Boolean(program) && name.trim().length > 0 && hasPrimary && !full

  const save = () => {
    if (!canSave) return
    const input = { name: name.trim(), equipment: equip, laterality, groups: roles }
    onClose()
    if (existing) change(m.saved(input.name), () => store.updateCustomExercise(existing.id, input))
    else change(m.created(input.name), () => store.addCustomExercise(input))
  }

  const mapValues = Object.fromEntries(Object.entries(roles).map(([g, r]) => [g, MAP_SETS[r]]))

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? m.editCustom : m.newCustom}
      description={m.customHint}
      footer={
        <div className="flex gap-2">
          {existing && (
            <Button
              onClick={() => {
                onClose()
                change(m.deleted(existing.name), () => store.removeCustomExercise(existing.id))
              }}
            >
              {m.delete}
            </Button>
          )}
          <Button variant="primary" block disabled={!canSave} onClick={save}>
            {existing ? m.save : m.create}
          </Button>
        </div>
      }
    >
      {full && <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-2">{m.customFull(MAX_CUSTOM)}</p>}
      <label className="block">
        <span className="text-sm font-semibold">{m.name}</span>
        <input
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder={m.namePlaceholder}
          className="mt-1.5 h-11 w-full rounded-md bg-surface-2 px-3 text-base placeholder:text-ink-3"
        />
      </label>

      <h3 className="mt-5 text-sm font-semibold">{m.muscles}</h3>
      <p className="mt-0.5 text-sm text-ink-2">{m.musclesHint}</p>
      <div className="mt-3 rounded-xl bg-surface p-3">
        <SegmentedControl
          label={m.mapSide}
          size="sm"
          block
          options={[
            { value: 'front', label: m.front },
            { value: 'back', label: m.back },
          ]}
          value={mapView}
          onChange={setMapView}
        />
        <BodyMap
          className="mx-auto mt-3 max-w-[11rem]"
          view={mapView}
          values={{ groups: mapValues, heads: {} }}
          scale="week"
          highlight={Object.keys(roles).filter((g) => roles[g] === 'primary')}
          onSelectGroup={(g) => setRole(g, NEXT[roles[g] ?? 'off'])}
          label={m.mapLabel}
        />
        <p className="mt-2 text-center text-xs text-ink-3">{m.mapLegend}</p>
      </div>

      {AREAS.map((area) => (
        <section key={area} className="mt-5">
          <h4 className="text-xs font-medium text-ink-3">{m.area[area]}</h4>
          <ul className="mt-1 divide-y divide-line">
            {allGroups
              .filter((g) => g.area === area)
              .map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-base">{groupName(g.id, locale)}</span>
                  <SegmentedControl
                    label={m.roleOf(groupName(g.id, locale))}
                    size="sm"
                    className="w-56 shrink-0"
                    options={[
                      { value: 'off', label: m.off },
                      { value: 'secondary', label: m.secondary },
                      { value: 'primary', label: m.primary },
                    ]}
                    value={roles[g.id] ?? 'off'}
                    onChange={(v) => setRole(g.id, v)}
                  />
                </li>
              ))}
          </ul>
        </section>
      ))}
      <h3 className="mt-6 text-sm font-semibold">{m.sides}</h3>
      <SegmentedControl
        label={m.sides}
        className="mt-1.5"
        block
        size="sm"
        options={[
          { value: 'bilateral', label: m.laterality.bilateral },
          { value: 'unilateral', label: m.laterality.unilateral },
          { value: 'alternating', label: m.laterality.alternating },
        ]}
        value={laterality}
        onChange={setLaterality}
      />

      <h3 className="mt-5 text-sm font-semibold">{m.equipment}</h3>
      <p className="mt-0.5 text-sm text-ink-2">{m.leaveEmpty}</p>
      <ChipGroup
        label={m.equipment}
        className="mt-2"
        size="sm"
        multiple
        options={equipment.map((e) => ({ value: e.id, label: equipmentName(e.id, locale) }))}
        value={equip}
        onChange={setEquip}
      />

    </Sheet>
  )
}

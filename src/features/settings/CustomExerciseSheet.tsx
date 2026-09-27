import { useState } from 'react'
import { equipment } from '../../domain/equipment'
import { MAX_CUSTOM, NAME_MAX } from '../../domain/program'
import type { CustomExercise, Role } from '../../domain/schema'
import { groups as allGroups } from '../../domain/taxonomy'
import { useActiveProgram, useProgramStore } from '../../store/program.store'
import { BodyMap } from '../bodymap'
import { Button, ChipGroup, SegmentedControl, Sheet } from '../../ui'
import { groupName } from '../builder/labels'
import { useChange } from '../builder/useChange'

type Laterality = CustomExercise['laterality']
type RoleChoice = Role | 'off'

const AREAS = [
  { id: 'upper', label: 'Upper body' },
  { id: 'core', label: 'Core' },
  { id: 'lower', label: 'Lower body' },
] as const

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
    if (existing) change(`Saved ${input.name}`, () => store.updateCustomExercise(existing.id, input))
    else change(`Created ${input.name}`, () => store.addCustomExercise(input))
  }

  const mapValues = Object.fromEntries(Object.entries(roles).map(([g, r]) => [g, MAP_SETS[r]]))

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Edit custom exercise' : 'New custom exercise'}
      description="Your own mapping. It counts like any other exercise."
      footer={
        <div className="flex gap-2">
          {existing && (
            <Button
              onClick={() => {
                onClose()
                change(`Deleted ${existing.name}`, () => store.removeCustomExercise(existing.id))
              }}
            >
              Delete
            </Button>
          )}
          <Button variant="primary" block disabled={!canSave} onClick={save}>
            {existing ? 'Save' : 'Create'}
          </Button>
        </div>
      }
    >
      {full && <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-2">This program already has {MAX_CUSTOM} custom exercises, the maximum.</p>}
      <label className="block">
        <span className="text-sm font-semibold">Name</span>
        <input
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Landmine press"
          className="mt-1.5 h-11 w-full rounded-md bg-surface-2 px-3 text-base placeholder:text-ink-3"
        />
      </label>

      <h3 className="mt-5 text-sm font-semibold">Muscles</h3>
      <p className="mt-0.5 text-sm text-ink-2">Tap the map to cycle primary, secondary, off, or use the list. At least one primary.</p>
      <div className="mt-3 rounded-xl bg-surface p-3">
        <SegmentedControl
          label="Map side"
          size="sm"
          block
          options={[
            { value: 'front', label: 'Front' },
            { value: 'back', label: 'Back' },
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
          label="Muscle map for this exercise"
        />
        <p className="mt-2 text-center text-xs text-ink-3">Outlined and darker: primary. Lighter: secondary.</p>
      </div>

      {AREAS.map((area) => (
        <section key={area.id} className="mt-5">
          <h4 className="text-xs font-medium text-ink-3">{area.label}</h4>
          <ul className="mt-1 divide-y divide-line">
            {allGroups
              .filter((g) => g.area === area.id)
              .map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-base">{groupName(g.id)}</span>
                  <SegmentedControl
                    label={`${groupName(g.id)} role`}
                    size="sm"
                    className="w-56 shrink-0"
                    options={[
                      { value: 'off', label: 'Off' },
                      { value: 'secondary', label: 'Secondary' },
                      { value: 'primary', label: 'Primary' },
                    ]}
                    value={roles[g.id] ?? 'off'}
                    onChange={(v) => setRole(g.id, v)}
                  />
                </li>
              ))}
          </ul>
        </section>
      ))}
      <h3 className="mt-6 text-sm font-semibold">Sides</h3>
      <SegmentedControl
        label="Sides"
        className="mt-1.5"
        block
        size="sm"
        options={[
          { value: 'bilateral', label: 'Both at once' },
          { value: 'unilateral', label: 'One side' },
          { value: 'alternating', label: 'Alternating' },
        ]}
        value={laterality}
        onChange={setLaterality}
      />

      <h3 className="mt-5 text-sm font-semibold">Equipment</h3>
      <p className="mt-0.5 text-sm text-ink-2">Leave empty for bodyweight.</p>
      <ChipGroup
        label="Equipment"
        className="mt-2"
        size="sm"
        multiple
        options={equipment.map((e) => ({ value: e.id, label: e.name }))}
        value={equip}
        onChange={setEquip}
      />

    </Sheet>
  )
}

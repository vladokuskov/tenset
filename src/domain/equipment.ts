import raw from '../../data/equipment.json' with { type: 'json' }
import type { Catalog } from './resolve.ts'
import type { Program } from './schema.ts'

export type EquipmentItem = { id: string; name: string; group: string }
export type EquipmentGroup = { id: string; name: string; items: readonly EquipmentItem[] }
export type EquipmentPreset = { id: string; name: string; equipment: string[] }

type RawPreset = { id: string; name: string; equipment: string | string[] }

export const ALL_EQUIPMENT = '*'

export const equipment: readonly EquipmentItem[] = raw.equipment
export const equipmentIds: readonly string[] = equipment.map((e) => e.id)

export const equipmentGroups: readonly EquipmentGroup[] = raw.groups.map((g) => ({
  ...g,
  items: equipment.filter((e) => e.group === g.id),
}))

export const presets: readonly EquipmentPreset[] = (raw.presets as RawPreset[]).map((p) => ({
  id: p.id,
  name: p.name,
  equipment: p.equipment === ALL_EQUIPMENT ? [...equipmentIds] : [...(p.equipment as string[])],
}))

export function presetEquipment(presetId: string): string[] {
  return [...(presets.find((p) => p.id === presetId)?.equipment ?? [])]
}

/** Preset whose equipment set matches the list exactly, or null for a custom selection. */
export function matchPreset(available: readonly string[]): string | null {
  const set = availableSet(available)
  for (const p of presets) {
    if (p.equipment.length === set.size && p.equipment.every((e) => set.has(e))) return p.id
  }
  return null
}

/** Expands "*" to every known equipment id. */
export function availableSet(available: Iterable<string>): Set<string> {
  const set = new Set(available)
  return set.has(ALL_EQUIPMENT) ? new Set(equipmentIds) : set
}

/** Exercise equipment is an AND list; [] means bodyweight. */
export function hasEquipment(exercise: { equipment: readonly string[] }, available: Iterable<string>): boolean {
  const set: ReadonlySet<string> =
    available instanceof Set && !available.has(ALL_EQUIPMENT) ? available : availableSet(available)
  return exercise.equipment.every((e) => set.has(e))
}

/** How much of a group the selection covers. */
export function groupState(group: EquipmentGroup, selected: ReadonlySet<string>): 'all' | 'some' | 'none' {
  const n = group.items.filter((e) => selected.has(e.id)).length
  return n === 0 ? 'none' : n === group.items.length ? 'all' : 'some'
}

/** Distinct exercises in the program whose equipment the selection doesn't cover. */
export function exercisesNeedingOther(program: Program, catalog: Catalog, available: Iterable<string>): number {
  const set = availableSet(available)
  const refs = new Set(program.days.flatMap((d) => d.entries.map((e) => e.exerciseId)))
  let n = 0
  for (const ref of refs) {
    const ex = typeof ref === 'string' ? program.custom.find((c) => c.id === ref) : catalog.get(ref)
    if (ex && !hasEquipment(ex, set)) n++
  }
  return n
}

import raw from '../../data/equipment.json' with { type: 'json' }

export type EquipmentItem = { id: string; name: string }
export type EquipmentPreset = { id: string; name: string; equipment: string[] }

type RawPreset = { id: string; name: string; equipment: string | string[] }

export const ALL_EQUIPMENT = '*'

export const equipment: readonly EquipmentItem[] = raw.equipment
export const equipmentIds: readonly string[] = equipment.map((e) => e.id)

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

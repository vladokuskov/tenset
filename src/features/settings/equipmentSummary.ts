import { equipment, matchPreset, presets } from '../../domain/equipment'

/** "Basic gym", or "Custom, 14 of 26 items" when no preset matches. */
export function equipmentSummary(value: readonly string[]): string {
  const preset = matchPreset(value)
  return preset ? presets.find((p) => p.id === preset)!.name : `Custom, ${value.length} of ${equipment.length} items`
}

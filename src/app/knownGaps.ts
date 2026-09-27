import raw from '../../data/known-gaps.json' with { type: 'json' }
import { availableSet, presets } from '../domain/equipment'
import { getGroup } from '../domain/taxonomy'

type Gap = { preset: string; groups: string[] }

const gaps: readonly Gap[] = raw.gaps

/**
 * Banded groups the equipment can't load (data/known-gaps.json). A preset's gaps hold for any smaller
 * selection too, so custom equipment gets the gaps of every preset that contains it.
 */
export function equipmentGaps(equipment: readonly string[]): string[] {
  const have = [...availableSet(equipment)]
  const out = new Set<string>()
  for (const p of presets) {
    if (!have.every((e) => p.equipment.includes(e))) continue
    for (const g of gaps.find((x) => x.preset === p.id)?.groups ?? []) out.add(g)
  }
  return [...out]
}

/** Neutral note: "Your equipment can't load: side delts, rear delts." Null when nothing is out of reach. */
export function gapNote(equipment: readonly string[]): string | null {
  const groups = equipmentGaps(equipment)
  if (!groups.length) return null
  return `Your equipment can't load: ${groups.map((g) => (getGroup(g)?.name ?? g).toLowerCase()).join(', ')}.`
}

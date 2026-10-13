import { availableSet, hasEquipment } from './equipment.ts'
import { swapEntry } from './program.ts'
import type { Catalog } from './resolve.ts'
import type { Exercise, Program } from './schema.ts'

type DayIndex = number

export type EquipmentSwap = { entryId: string; day: DayIndex; from: number; to: number }
export type EquipmentSwapPlan = {
  swaps: EquipmentSwap[]
  /** Entries that need other equipment and have no fitting alternative (custom exercises included). */
  unmatched: number
}

const primaries = (e: Exercise) => Object.keys(e.groups).filter((g) => e.groups[g] === 'primary')

function jaccard(a: readonly string[], b: readonly string[]): number {
  const set = new Set(a)
  const shared = b.filter((x) => set.has(x)).length
  const union = new Set([...a, ...b]).size
  return union ? shared / union : 0
}

/**
 * Candidates that keep every primary group of the target, on the same movement pattern (or listed as its
 * alternative), ranked: curated order, then closest primary and overall group sets, then level, then id.
 */
function rankFor(target: Exercise, pool: readonly Exercise[]): Exercise[] {
  const own = primaries(target)
  const curated = new Map(target.alternatives.map((id, i) => [id, i]))
  const all = Object.keys(target.groups)
  return pool
    .filter((e) => e.id !== target.id && (curated.has(e.id) || e.pattern === target.pattern))
    .filter((e) => own.every((g) => e.groups[g] === 'primary'))
    .map((e) => ({
      e,
      rank: curated.get(e.id) ?? Infinity,
      prim: jaccard(own, primaries(e)),
      groups: jaccard(all, Object.keys(e.groups)),
      level: Math.abs(e.level - target.level),
    }))
    .sort((a, b) => a.rank - b.rank || b.prim - a.prim || b.groups - a.groups || a.level - b.level || a.e.id - b.e.id)
    .map((x) => x.e)
}

/** For each entry the equipment does not cover, the best fitting catalog alternative. Pure; see applyEquipmentSwap. */
export function planEquipmentSwap(
  program: Program,
  catalog: Catalog,
  exercises: readonly Exercise[],
  available: Iterable<string>,
): EquipmentSwapPlan {
  const avail = availableSet(available)
  const pool = exercises.filter((e) => e.status === 'active' && hasEquipment(e, avail))
  const swaps: EquipmentSwap[] = []
  let unmatched = 0
  program.days.forEach((day, d) => {
    // Avoid turning two entries of one day into the same exercise when another option exists.
    const used = new Set(day.entries.map((e) => e.exerciseId))
    for (const entry of day.entries) {
      const ref = entry.exerciseId
      if (typeof ref === 'string') {
        const own = program.custom.find((c) => c.id === ref)
        if (own && !hasEquipment(own, avail)) unmatched++
        continue
      }
      const ex = catalog.get(ref)
      if (!ex || hasEquipment(ex, avail)) continue
      const ranked = rankFor(ex, pool)
      const pick = ranked.find((e) => !used.has(e.id)) ?? ranked[0]
      if (!pick) {
        unmatched++
        continue
      }
      used.add(pick.id)
      swaps.push({ entryId: entry.id, day: d, from: ex.id, to: pick.id })
    }
  })
  return { swaps, unmatched }
}

export function applyEquipmentSwap(program: Program, swaps: readonly EquipmentSwap[]): Program {
  return swaps.reduce((p, s) => swapEntry(p, s.entryId, s.to), program)
}

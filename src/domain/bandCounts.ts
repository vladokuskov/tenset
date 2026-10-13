import { bandedGroupIds } from './taxonomy.ts'
import type { BandId, WeekResult } from './volume.ts'

export type BandCounts = {
  /** Required groups the user has not skipped. */
  total: number
  inTarget: number
  /** Below the target range, in weekly-set order (fewest first). */
  below: string[]
  above: number
}

const BELOW: readonly BandId[] = ['none', 'light', 'moderate']
const ABOVE: readonly BandId[] = ['high', 'very_high']

/** Where the main (non-optional) groups sit against their target range this week. */
export function bandCounts(week: WeekResult): BandCounts {
  const main = bandedGroupIds.filter((g) => {
    const band = week.bands[g]
    return band && !band.optional
  })
  const bandOf = (g: string) => week.bands[g]?.band ?? 'none'
  const below = main
    .filter((g) => BELOW.includes(bandOf(g)))
    .sort((a, b) => (week.weekly[a] ?? 0) - (week.weekly[b] ?? 0))
  return {
    total: main.length,
    inTarget: main.filter((g) => bandOf(g) === 'target').length,
    below,
    above: main.filter((g) => ABOVE.includes(bandOf(g))).length,
  }
}

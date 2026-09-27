import type { Prefs } from '../domain/schema'
import type { BandEdges } from '../domain/taxonomy'
import type { BandId, BandResult } from '../domain/volume'
import { formatSets } from './format'

export type GoalId = Prefs['goal']

export const BAND_ORDER: readonly BandId[] = ['none', 'light', 'moderate', 'target', 'high', 'very_high']

export type BandCopyOptions = { goal?: GoalId; optional?: boolean }

/** Optional groups have no "light" band: below the first edge they read as moderate. */
export function displayBand(band: BandId, optional = false): BandId {
  return optional && band === 'light' ? 'moderate' : band
}

/** Pill text. Never "optimal", "under" or "maintenance". */
export function bandLabel(band: BandId, { goal, optional }: BandCopyOptions = {}): string {
  switch (displayBand(band, optional)) {
    case 'none':
      return 'not trained'
    case 'light':
      return 'light'
    case 'moderate':
      return goal === 'general' ? 'good for general fitness' : 'moderate'
    case 'target':
      return 'target range'
    case 'high':
      return 'high'
    case 'very_high':
      return 'very high'
  }
}

export function bandLabelFor(result: BandResult, goal?: GoalId): string {
  return bandLabel(result.band, { goal, optional: result.optional })
}

/** "target 10-20" (optional groups carry their own edges, e.g. "target 6-16"). */
export function targetText(edges: BandEdges): string {
  return `target ${formatSets(edges[1])}-${formatSets(edges[2])}`
}

/** Weekly set range a band covers, for legends and the "why?" popover. */
export function bandRange(band: BandId, edges: BandEdges, optional = false): string {
  const [a, b, c, d] = edges.map(formatSets)
  switch (displayBand(band, optional)) {
    case 'none':
      return '0 sets'
    case 'light':
      return `fewer than ${a} sets`
    case 'moderate':
      return optional ? `fewer than ${b} sets` : `${a} to ${b} sets`
    case 'target':
      return `${b} to ${c} sets`
    case 'high':
      return `${c} to ${d} sets`
    case 'very_high':
      return `over ${d} sets`
  }
}

/** One plain sentence explaining a band. Neutral: no warnings, no advice to cut back. */
export function bandExplanation(band: BandId, edges: BandEdges, { goal, optional }: BandCopyOptions = {}): string {
  const [a, b, c, d] = edges.map(formatSets)
  switch (displayBand(band, optional)) {
    case 'none':
      return 'No sets count toward this group this week.'
    case 'light':
      return `Fewer than ${a} weekly sets.`
    case 'moderate':
      if (goal === 'general') return `Fewer than ${b} weekly sets, which is plenty for general fitness.`
      return optional ? `Fewer than ${b} weekly sets. This group is optional.` : `${a} to ${b} weekly sets.`
    case 'target':
      return `${b} to ${c} weekly sets, the range most studies use for muscle growth.`
    case 'high':
      return `${c} to ${d} weekly sets. Each extra set adds less than the ones before it.`
    case 'very_high':
      return `More than ${d} weekly sets.`
  }
}

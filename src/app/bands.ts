import type { Prefs } from '../domain/schema'
import type { BandEdges } from '../domain/taxonomy'
import type { BandId, BandResult } from '../domain/volume'
import { formatSets } from './format'

export type GoalId = Prefs['goal']

/** A band as the copy names it. Optional groups have no "light": below their first edge they read "some sets". */
export type DisplayBand = BandId | 'some'

export const BAND_ORDER: readonly BandId[] = ['none', 'light', 'moderate', 'target', 'high', 'very_high']

export type BandCopyOptions = { goal?: GoalId }

// The engine files optional groups under their first edge as moderate; the copy keeps that apart.
export function displayBand(result: Pick<BandResult, 'band' | 'value' | 'edges' | 'optional'>): DisplayBand {
  if (!result.optional) return result.band
  if (result.band === 'light' || (result.value > 0 && result.value < result.edges[0])) return 'some'
  return result.band
}

/** Pill text. Never "optimal", "under" or "maintenance". */
export function bandLabel(band: DisplayBand, { goal }: BandCopyOptions = {}): string {
  switch (band) {
    case 'none':
      return 'not trained'
    case 'some':
      return 'some sets'
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
  return bandLabel(displayBand(result), { goal })
}

/** "target 10-20" (optional groups carry their own edges, e.g. "target 6-16"). */
export function targetText(edges: BandEdges): string {
  return `target ${formatSets(edges[1])}-${formatSets(edges[2])}`
}

/** Weekly set range a band covers, for legends and the "why?" popover. */
export function bandRange(band: DisplayBand, edges: BandEdges): string {
  const [a, b, c, d] = edges.map(formatSets)
  switch (band) {
    case 'none':
      return '0 sets'
    case 'some':
    case 'light':
      return `fewer than ${a} sets`
    case 'moderate':
      return `${a} to ${b} sets`
    case 'target':
      return `${b} to ${c} sets`
    case 'high':
      return `${c} to ${d} sets`
    case 'very_high':
      return `over ${d} sets`
  }
}

/** One plain sentence explaining a band. Neutral: no warnings, no advice to cut back. */
export function bandExplanation(band: DisplayBand, edges: BandEdges, { goal }: BandCopyOptions = {}): string {
  const [a, b, c, d] = edges.map(formatSets)
  switch (band) {
    case 'none':
      return 'No sets count toward this group this week.'
    case 'some':
      return `Fewer than ${a} weekly sets. This group is optional.`
    case 'light':
      return `Fewer than ${a} weekly sets.`
    case 'moderate':
      return goal === 'general' ? `${a} to ${b} weekly sets, which is plenty for general fitness.` : `${a} to ${b} weekly sets.`
    case 'target':
      return `${b} to ${c} weekly sets, the range most studies use for muscle growth.`
    case 'high':
      return `${c} to ${d} weekly sets. Each extra set adds less than the ones before it.`
    case 'very_high':
      return `More than ${d} weekly sets.`
  }
}

export function bandExplanationFor(result: BandResult, goal?: GoalId): string {
  return bandExplanation(displayBand(result), result.edges, { goal })
}

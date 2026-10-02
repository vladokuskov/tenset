import { classifyBand, DAY_INTENSITY_SETS, WEEK_INTENSITY_SETS, type BandId } from '../domain/volume'
import { headGroup, type BandEdges } from '../domain/taxonomy'
import { shadeEdges, type Targets } from '../domain/targets'

export type MapScale = 'week' | 'day'

/** CSS color for each band step. The scale is single-hue, so steps differ by lightness. */
export const VOLUME_COLOR: Record<BandId, string> = {
  none: 'var(--color-vol-none)',
  light: 'var(--color-vol-light)',
  moderate: 'var(--color-vol-moderate)',
  target: 'var(--color-vol-target)',
  high: 'var(--color-vol-high)',
  very_high: 'var(--color-vol-very-high)',
}

export const ROLE_COLOR = {
  primary: 'var(--color-role-primary)',
  secondary: 'var(--color-role-secondary)',
} as const

/** Single-day edges: the weekly edges scaled by the engine's day/week intensity ratio (10/30). */
export function dayEdges(edges: BandEdges): BandEdges {
  const k = DAY_INTENSITY_SETS / WEEK_INTENSITY_SETS
  return edges.map((e) => e * k) as BandEdges
}

/**
 * Band step used to shade a group. Unbanded groups shade on the default edges but never get a label.
 * Optional groups below their first edge take the light step (their label reads "some sets").
 * Personal ranges move the steps; skipped groups shade on the research range.
 */
export function groupShade(group: string, sets: number, scale: MapScale = 'week', targets?: Targets): BandId {
  const edges = shadeEdges(group, targets)
  return classifyBand(sets, scale === 'day' ? dayEdges(edges) : edges, false)
}

/** Heads shade on their group's edges (same set scale, never labeled). */
export function headShade(head: string, sets: number, scale: MapScale = 'week', targets?: Targets): BandId {
  const group = headGroup(head)
  return group ? groupShade(group, sets, scale, targets) : sets > 0 ? 'moderate' : 'none'
}

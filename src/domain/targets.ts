import type { TargetMode, TargetPref } from './schema.ts'
import { bandEdges, isOptional, taxonomy, type BandEdges } from './taxonomy.ts'

export type Targets = Readonly<Record<string, TargetPref>>

export type GroupTarget = {
  /** Edges used for the band; null when the group is unbanded or skipped. */
  edges: BandEdges | null
  /** The research range from the taxonomy; null for unbanded groups. */
  cited: BandEdges | null
  optional: boolean
  mode: TargetMode
}

export const TARGET_MIN = 1
export const TARGET_MAX = 60

/** Builds full edges around a target range, keeping the outer steps in proportion to the cited ones. */
export function edgesFromRange(min: number, max: number, cited: BandEdges): BandEdges {
  const lo = Math.min(TARGET_MAX - 1, Math.max(TARGET_MIN, Math.round(Math.min(min, max))))
  const hi = Math.min(TARGET_MAX, Math.max(lo + 1, Math.round(Math.max(min, max))))
  const [a0, b0, c0, d0] = cited
  const a = Math.min(lo, Math.max(1, Math.round((lo * a0) / b0)))
  const d = Math.max(hi + 1, Math.round((hi * d0) / c0))
  return [a, lo, hi, d]
}

function shifted(cited: BandEdges, dir: 1 | -1): BandEdges {
  const [, b, c] = cited
  const s = Math.round((c - b) / 2)
  if (dir === 1) return edgesFromRange(b + s, c + s, cited)
  const lo = Math.max(1, b - s)
  return edgesFromRange(lo, Math.max(lo + 1, c - s), cited)
}

export function resolveTarget(groupId: string, targets?: Targets): GroupTarget {
  const cited = bandEdges(groupId)
  const optional = isOptional(groupId)
  const pref = cited ? targets?.[groupId] : undefined
  if (!cited || !pref) return { edges: cited, cited, optional, mode: 'normal' }
  switch (pref.mode) {
    case 'skip':
      return { edges: null, cited, optional, mode: 'skip' }
    case 'less':
      return { edges: shifted(cited, -1), cited, optional, mode: 'less' }
    case 'more':
      return { edges: shifted(cited, 1), cited, optional: false, mode: 'more' }
    case 'custom':
      return { edges: edgesFromRange(pref.min, pref.max, cited), cited, optional: false, mode: 'custom' }
  }
}

/** Edges for map shading: skipped groups shade on the cited scale, unbanded ones on the default. */
export function shadeEdges(groupId: string, targets?: Targets): BandEdges {
  const t = resolveTarget(groupId, targets)
  return t.edges ?? t.cited ?? ([...taxonomy.bandEdgesDefault] as BandEdges)
}

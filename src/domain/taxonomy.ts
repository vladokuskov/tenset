import raw from '../../data/taxonomy.json' with { type: 'json' }
import { Taxonomy, type DeepHead, type Group, type Head } from './schema.ts'

export type BandEdges = [number, number, number, number]

export const taxonomy: Taxonomy = Taxonomy.parse(raw)

export const groups: readonly Group[] = taxonomy.groups
export const groupIds: readonly string[] = groups.map((g) => g.id)
export const bandedGroupIds: readonly string[] = groups.filter((g) => g.banded).map((g) => g.id)
export const visibleHeads: readonly Head[] = taxonomy.heads
export const deepHeads: readonly DeepHead[] = taxonomy.deepHeads

const groupById = new Map(groups.map((g) => [g.id, g]))
const headGroupById = new Map<string, string>([
  ...visibleHeads.map((h) => [h.id, h.group] as const),
  ...deepHeads.map((h) => [h.id, h.group] as const),
])
const parentById = new Map(deepHeads.map((h) => [h.id, h.parent]))
const visibleByGroup = new Map<string, string[]>()
const allByGroup = new Map<string, string[]>()
const deepByParent = new Map<string, string[]>()

for (const g of groups) {
  visibleByGroup.set(g.id, [])
  allByGroup.set(g.id, [])
}
for (const h of visibleHeads) {
  visibleByGroup.get(h.group)?.push(h.id)
  allByGroup.get(h.group)?.push(h.id)
}
for (const h of deepHeads) {
  allByGroup.get(h.group)?.push(h.id)
  if (h.parent) deepByParent.set(h.parent, [...(deepByParent.get(h.parent) ?? []), h.id])
}

export function getGroup(id: string): Group | undefined {
  return groupById.get(id)
}

export function isGroup(id: string): boolean {
  return groupById.has(id)
}

export function headGroup(headId: string): string | undefined {
  return headGroupById.get(headId)
}

export function headsOfGroup(groupId: string): readonly string[] {
  return visibleByGroup.get(groupId) ?? []
}

/** Visible and deep heads of a group. */
export function allHeadsOfGroup(groupId: string): readonly string[] {
  return allByGroup.get(groupId) ?? []
}

export function isDeepHead(headId: string): boolean {
  return parentById.has(headId)
}

/** Visible parent a deep head is drawn on; null for visible heads and list-only deep heads. */
export function parentOf(headId: string): string | null {
  return parentById.get(headId) ?? null
}

export function deepHeadsOf(visibleHeadId: string): readonly string[] {
  return deepByParent.get(visibleHeadId) ?? []
}

export function isBanded(groupId: string): boolean {
  return groupById.get(groupId)?.banded ?? false
}

export function isOptional(groupId: string): boolean {
  return groupById.get(groupId)?.optional ?? false
}

/** Group override or the default edges; null for unbanded or unknown groups. */
export function bandEdges(groupId: string): BandEdges | null {
  const g = groupById.get(groupId)
  if (!g || !g.banded) return null
  return [...(g.bandEdges ?? taxonomy.bandEdgesDefault)] as BandEdges
}

/**
 * Citation ids behind a group's edges. Groups with custom edges but no listed
 * source are reported as "heuristic" rather than borrowing the default sources.
 */
export function bandSources(groupId: string): string[] {
  const g = groupById.get(groupId)
  if (!g || !g.banded) return []
  if (g.bandSources?.length) return [...g.bandSources]
  if (g.bandEdges) return ['heuristic']
  return [...taxonomy.bandSources]
}

import type { QaStatus, ReviewItem } from './types.ts'

export type StatusFilter = QaStatus | 'all'

export const FILTERS: readonly StatusFilter[] = ['pending', 'rejected', 'approved', 'all']

export function matches(item: ReviewItem, filter: StatusFilter): boolean {
  return filter === 'all' || item.fields.motion === filter
}

export function countByStatus(items: readonly ReviewItem[]): Record<StatusFilter, number> {
  const c: Record<StatusFilter, number> = { pending: 0, approved: 0, rejected: 0, all: items.length }
  for (const i of items) c[i.fields.motion]++
  return c
}

/** Next (dir 1) or previous (dir -1) item in id order that passes the filter, wrapping; never the current one. */
export function step(items: readonly ReviewItem[], current: number | null, filter: StatusFilter, dir: 1 | -1): number | null {
  const pool = items.filter((i) => matches(i, filter) && i.id !== current).map((i) => i.id).sort((a, b) => a - b)
  if (!pool.length) return null
  if (current === null) return dir === 1 ? pool[0] : pool[pool.length - 1]
  if (dir === 1) return pool.find((id) => id > current) ?? pool[0]
  return [...pool].reverse().find((id) => id < current) ?? pool[pool.length - 1]
}

/** The item to show: the requested one if it exists, else the first that passes the filter. */
export function pick(items: readonly ReviewItem[], requested: number | undefined, filter: StatusFilter): ReviewItem | null {
  return items.find((i) => i.id === requested) ?? items.find((i) => matches(i, filter)) ?? null
}

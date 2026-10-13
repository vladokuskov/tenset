import { createStore } from 'zustand/vanilla'

export type Pulse = {
  key: number
  /** Groups whose weekly sets changed. */
  week: readonly string[]
  /** Groups whose sets changed on each day. */
  days: Readonly<Record<number, readonly string[]>>
}

export const pulseStore = createStore<{ current: Pulse | null }>(() => ({ current: null }))

let nextKey = 1

export function triggerPulse(week: readonly string[], days: Record<number, readonly string[]>): void {
  if (!week.length && !Object.keys(days).length) return
  pulseStore.setState({ current: { key: nextKey++, week, days } })
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

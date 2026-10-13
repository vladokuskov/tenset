import { createStore } from 'zustand/vanilla'

export type StorageHealth = {
  /** localStorage is missing or blocked, so nothing survives a reload. */
  memoryOnly: boolean
  /** A save threw (quota or blocked storage). */
  writeFailed: boolean
  /** Quarantine keys written during this session. */
  quarantined: string[]
}

export const storageHealth = createStore<StorageHealth>(() => ({ memoryOnly: false, writeFailed: false, quarantined: [] }))

export function reportMemoryOnly(): void {
  if (!storageHealth.getState().memoryOnly) storageHealth.setState({ memoryOnly: true })
}

export function reportWriteFailed(): void {
  if (!storageHealth.getState().writeFailed) storageHealth.setState({ writeFailed: true })
}

export function reportQuarantined(key: string): void {
  storageHealth.setState((s) => ({ quarantined: [...s.quarantined, key] }))
}

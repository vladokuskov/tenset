import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export const LAST_EXPORT_KEY = 'gb:last-export'

function read(): string | null {
  try {
    return localStorage.getItem(LAST_EXPORT_KEY)
  } catch {
    return null
  }
}

/** ISO time of the last backup saved or shared from this device. */
export const lastExportStore = createStore<{ at: string | null }>(() => ({ at: read() }))

export function recordExport(now: Date = new Date()): void {
  const at = now.toISOString()
  try {
    localStorage.setItem(LAST_EXPORT_KEY, at)
  } catch {
    // shown for this session only
  }
  lastExportStore.setState({ at })
}

export function forgetExport(): void {
  lastExportStore.setState({ at: null })
}

export function useLastExport(): string | null {
  return useStore(lastExportStore, (s) => s.at)
}

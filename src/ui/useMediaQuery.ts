import { useCallback, useSyncExternalStore } from 'react'

export const DESKTOP_QUERY = '(min-width: 80rem)'

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', onChange)
      return () => m.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Per-viewer UI memory (collapsed cards and similar). Never required for correctness. */
export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

export function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // storage blocked: keep it in memory only
  }
}

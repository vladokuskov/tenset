const KEY = 'tenset:chunk-reload'
const WINDOW_MS = 60_000

type SessionStore = Pick<Storage, 'getItem' | 'setItem'>

/** A dynamic import that failed to load, usually a chunk a newer deploy removed. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/.test(message)
}

/** True once per minute per tab, so a chunk that is really gone shows the error screen instead of looping. */
export function claimReload(storage: SessionStore | null, now = Date.now()): boolean {
  if (!storage) return false
  try {
    const last = Number(storage.getItem(KEY))
    if (last && now - last < WINDOW_MS) return false
    storage.setItem(KEY, String(now))
    return true
  } catch {
    return false
  }
}

function session(): SessionStore | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Reloads once when Vite fails to load a chunk, which picks up the new index.html and its hashes. Offline, a reload would only lose the page. */
export function installChunkReload(): void {
  window.addEventListener('vite:preloadError', () => {
    // Not preventDefault: that would resolve the import with undefined and break the caller before the reload lands.
    if (navigator.onLine && claimReload(session())) window.location.reload()
  })
}

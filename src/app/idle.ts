/** Runs `cb` when the browser is idle (a short timeout where requestIdleCallback is missing, as in Safari). Returns a cancel. */
export function whenIdle(cb: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(cb, { timeout: 5000 })
    return () => window.cancelIdleCallback(handle)
  }
  const handle = window.setTimeout(cb, 1500)
  return () => window.clearTimeout(handle)
}

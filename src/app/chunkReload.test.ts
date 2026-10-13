import { describe, expect, it } from 'vitest'
import { claimReload, isChunkLoadError } from './chunkReload'

function memory() {
  const map = new Map<string, string>()
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}

describe('chunk reload', () => {
  it('recognizes failed dynamic imports across browsers', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/body-abc.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/assets/a.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true)
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })

  it('allows one reload per minute, so a missing chunk cannot loop', () => {
    const store = memory()
    expect(claimReload(store, 1_000)).toBe(true)
    expect(claimReload(store, 30_000)).toBe(false)
    expect(claimReload(store, 62_000)).toBe(true)
  })

  it('does not reload when session storage is unavailable', () => {
    expect(claimReload(null)).toBe(false)
    const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => {} }
    expect(claimReload(throwing)).toBe(false)
  })
})

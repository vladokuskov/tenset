import { afterEach, describe, expect, it, vi } from 'vitest'
import { storageHealth } from './health.ts'
import { adoptLegacyBackup, listQuarantined, quarantine, serializeQuarantined } from './quarantine.ts'
import { browserStorage, memoryStorage, safeJSONStorage } from './storage.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  storageHealth.setState({ memoryOnly: false, writeFailed: false, quarantined: [] })
})

describe('storage', () => {
  it('falls back to memory and reports it when localStorage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
    })
    const s = browserStorage()
    s.setItem('k', 'v')
    expect(s.getItem('k')).toBe('v')
    expect(storageHealth.getState().memoryOnly).toBe(true)
  })

  it('quarantines unreadable JSON instead of dropping it', () => {
    const storage = memoryStorage()
    storage.setItem('gb:x', '{oops')
    expect(safeJSONStorage(storage).getItem('gb:x')).toBeNull()
    const [item] = listQuarantined(storage)
    expect(item).toMatchObject({ source: 'gb:x', data: '{oops' })
    expect(storageHealth.getState().quarantined).toEqual([item.key])
  })

  it('keeps same-millisecond quarantines apart and serializes them for download', () => {
    const storage = memoryStorage()
    const at = new Date('2026-10-13T10:00:00Z')
    const a = quarantine(storage, 'gb:x', { n: 1 }, at)
    const b = quarantine(storage, 'gb:x', { n: 2 }, at)
    expect(a).not.toBe(b)
    expect(quarantine(storage, 'gb:x', { n: 1 }, at)).toBeNull()
    const file = JSON.parse(serializeQuarantined(listQuarantined(storage)))
    expect(file.items.map((i: { data: unknown }) => i.data)).toEqual([{ n: 1 }, { n: 2 }])
  })

  it('moves the old single-slot corrupt backup into the quarantine', () => {
    const storage = memoryStorage()
    storage.setItem('gb:programs:corrupt', JSON.stringify({ programs: { a: { name: 'Old' } } }))
    adoptLegacyBackup(storage, 'gb:programs')
    expect(storage.getItem('gb:programs:corrupt')).toBeNull()
    expect(listQuarantined(storage).map((i) => i.data)).toEqual([{ programs: { a: { name: 'Old' } } }])
    adoptLegacyBackup(storage, 'gb:programs')
    expect(listQuarantined(storage)).toHaveLength(1)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { requestPersistentStorage } from './persist.ts'

describe('requestPersistentStorage', () => {
  it('asks only when storage is not persistent yet', async () => {
    const persist = vi.fn(async () => true)
    expect(await requestPersistentStorage({ persisted: async () => false, persist })).toBe(true)
    expect(persist).toHaveBeenCalledOnce()
    persist.mockClear()
    expect(await requestPersistentStorage({ persisted: async () => true, persist })).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('returns false without the API or when it throws', async () => {
    expect(await requestPersistentStorage(undefined)).toBe(false)
    const persisted = async () => {
      throw new Error('denied')
    }
    expect(await requestPersistentStorage({ persisted, persist: async () => true })).toBe(false)
  })
})

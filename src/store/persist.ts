type StorageManagerLike = Pick<StorageManager, 'persist' | 'persisted'>

/**
 * Asks the browser not to evict this site's storage, the only copy of the user's programs.
 * Chromium decides silently; Firefox may ask the user, so this runs only after a change.
 */
export async function requestPersistentStorage(manager: StorageManagerLike | undefined = globalThis.navigator?.storage): Promise<boolean> {
  try {
    if (!manager?.persist) return false
    if (await manager.persisted()) return true
    return await manager.persist()
  } catch {
    return false
  }
}

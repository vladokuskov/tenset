import { reportQuarantined } from './health.ts'
import type { SyncStorage } from './storage.ts'

/** Lists the quarantine keys, so they can be found without enumerating storage. */
export const QUARANTINE_INDEX = 'gb:quarantine'
export const QUARANTINE_PREFIX = 'gb:quarantine:'

export type QuarantineItem = { key: string; source: string; at: string; data: unknown }

function readIndex(storage: SyncStorage): string[] {
  try {
    const raw = JSON.parse(storage.getItem(QUARANTINE_INDEX) ?? '[]')
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/**
 * Keeps data that failed validation under its own timestamped key, so a later failure never overwrites
 * an earlier one. Data identical to something already kept is not stored twice. Returns the new key.
 */
export function quarantine(storage: SyncStorage, source: string, data: unknown, now: Date = new Date()): string | null {
  try {
    const index = readIndex(storage)
    const payload = JSON.stringify({ source, at: now.toISOString(), data })
    const body = JSON.stringify(data)
    for (const key of index) {
      try {
        if (JSON.stringify(JSON.parse(storage.getItem(key) ?? 'null')?.data) === body) return null
      } catch {
        // unreadable entry: compare the next one
      }
    }
    let key = `${QUARANTINE_PREFIX}${source}:${now.getTime()}`
    for (let n = 2; index.includes(key); n++) key = `${QUARANTINE_PREFIX}${source}:${now.getTime()}-${n}`
    storage.setItem(key, payload)
    storage.setItem(QUARANTINE_INDEX, JSON.stringify([...index, key]))
    reportQuarantined(key)
    return key
  } catch {
    return null
  }
}

export function listQuarantined(storage: SyncStorage): QuarantineItem[] {
  const items: QuarantineItem[] = []
  for (const key of readIndex(storage)) {
    try {
      const raw = JSON.parse(storage.getItem(key) ?? 'null')
      if (raw && typeof raw === 'object') items.push({ key, source: String(raw.source), at: String(raw.at), data: raw.data })
    } catch {
      // skip
    }
  }
  return items
}

/** One JSON file with everything kept aside, for the user to download. */
export function serializeQuarantined(items: readonly QuarantineItem[]): string {
  return `${JSON.stringify({ format: 'tenset-set-aside', items }, null, 2)}\n`
}

/** Moves the single-slot `<name>:corrupt` backup written by older versions into the quarantine. */
export function adoptLegacyBackup(storage: SyncStorage, name: string): void {
  try {
    const legacy = `${name}:corrupt`
    const raw = storage.getItem(legacy)
    if (raw === null) return
    let data: unknown = raw
    try {
      data = JSON.parse(raw)
    } catch {
      // keep the raw text
    }
    quarantine(storage, name, data)
    const body = JSON.stringify(data)
    if (listQuarantined(storage).some((i) => JSON.stringify(i.data) === body)) storage.removeItem(legacy)
  } catch {
    // leave it where it is
  }
}

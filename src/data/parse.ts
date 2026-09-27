import type { z } from 'zod'

/** Parses glob-imported records, skipping invalid ones (reported through `warn`). */
export function parseRecords<T>(
  modules: Record<string, unknown>,
  schema: z.ZodType<T>,
  warn: (message: string) => void = () => {},
): T[] {
  const out: T[] = []
  for (const [path, raw] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    const result = schema.safeParse(raw)
    if (result.success) out.push(result.data)
    else warn(`Skipping ${path}: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
  }
  return out
}

/** Retired id -> replacement id, for decoding old share links. */
export function replacementMap(records: readonly { id: number; status: string; replacedBy: number | null }[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const r of records) if (r.status === 'retired' && r.replacedBy !== null) map.set(r.id, r.replacedBy)
  return map
}

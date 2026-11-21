import { Prefs } from '../domain/schema.ts'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export type SalvagedPrefs = { prefs: Partial<Prefs>; rejected: Record<string, unknown> | null }

/** Field by field: a bad field falls back to its default and the others are kept. */
export function salvagePrefs(persisted: unknown): SalvagedPrefs {
  if (!isRecord(persisted)) return { prefs: {}, rejected: { value: persisted } }
  const prefs: Record<string, unknown> = {}
  const rejected: Record<string, unknown> = {}
  for (const [field, schema] of Object.entries(Prefs.shape)) {
    if (!(field in persisted)) continue
    const parsed = schema.safeParse(persisted[field])
    if (parsed.success) prefs[field] = parsed.data
    else rejected[field] = persisted[field]
  }
  return { prefs: prefs as Partial<Prefs>, rejected: Object.keys(rejected).length ? rejected : null }
}

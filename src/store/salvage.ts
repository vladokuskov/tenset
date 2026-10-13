import { Prefs, type Program } from '../domain/schema.ts'
import { repairProgram } from '../domain/validateProgram.ts'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export type SalvagedPrograms = {
  programs: Record<string, Program>
  activeId: string | null
  /** What failed validation, to quarantine. Null when everything was usable. */
  rejected: unknown
}

/** Keeps every program that passes validation on its own, so one bad program never hides the rest. */
export function salvagePrograms(persisted: unknown): SalvagedPrograms {
  if (!isRecord(persisted) || !isRecord(persisted.programs)) return { programs: {}, activeId: null, rejected: persisted }
  const programs: Record<string, Program> = {}
  const rejected: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(persisted.programs)) {
    const program = repairProgram(raw)
    if (program) programs[key] = program
    else rejected[key] = raw
  }
  const activeId = typeof persisted.activeId === 'string' ? persisted.activeId : null
  return { programs, activeId, rejected: Object.keys(rejected).length ? { programs: rejected } : null }
}

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

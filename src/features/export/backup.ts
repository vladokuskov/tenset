import { z } from 'zod'
import { Prefs, Program } from '../../domain/schema'
import { runMigrations, type MigrationChain } from '../../store/migrations'

export const BACKUP_FORMAT = 'gym-builder-backup'
export const BACKUP_VERSION = 1
const MAX_BYTES = 5_000_000

// Keyed by the version a step migrates from, like the store migrations.
export const backupMigrations: MigrationChain = {}

const Envelope = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().min(1),
})

const BackupV1 = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  exportedAt: z.string(),
  activeId: z.string().nullable(),
  programs: z.array(z.unknown()),
  prefs: z.unknown(),
})

export type Backup = {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  activeId: string | null
  programs: Program[]
  prefs: Prefs
}

export type ParsedBackup = {
  exportedAt: string
  programs: Program[]
  /** Programs in the file that failed validation and will be skipped. */
  skipped: number
  /** Null when the file's settings are unreadable; programs can still be imported. */
  prefs: Prefs | null
}

export type BackupError = 'too_large' | 'not_json' | 'wrong_file' | 'newer_version' | 'invalid'

export type ParseBackupResult = { ok: true; backup: ParsedBackup; activeId: string | null } | { ok: false; error: BackupError }

export function createBackup(
  state: { programs: Record<string, Program>; activeId: string | null },
  prefs: Prefs,
  now: Date = new Date(),
): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    activeId: state.activeId,
    programs: Object.values(state.programs),
    prefs: {
      goal: prefs.goal,
      equipment: [...prefs.equipment],
      countingMode: prefs.countingMode,
      weekStart: prefs.weekStart,
      overrides: prefs.overrides,
    },
  }
}

export function serializeBackup(backup: Backup): string {
  return `${JSON.stringify(backup, null, 2)}\n`
}

export function backupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `gym-builder-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

export function parseBackup(text: string): ParseBackupResult {
  if (text.length > MAX_BYTES) return { ok: false, error: 'too_large' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'not_json' }
  }
  const envelope = Envelope.safeParse(raw)
  if (!envelope.success) return { ok: false, error: 'wrong_file' }
  if (envelope.data.version > BACKUP_VERSION) return { ok: false, error: 'newer_version' }

  let migrated: unknown
  try {
    migrated = runMigrations(raw, envelope.data.version, BACKUP_VERSION, backupMigrations)
  } catch {
    return { ok: false, error: 'invalid' }
  }
  const file = BackupV1.safeParse(migrated)
  if (!file.success) return { ok: false, error: 'invalid' }

  const programs: Program[] = []
  let skipped = 0
  for (const p of file.data.programs) {
    const parsed = Program.safeParse(p)
    if (parsed.success) programs.push(parsed.data)
    else skipped++
  }
  const prefs = Prefs.safeParse(file.data.prefs)
  if (!programs.length && !prefs.success) return { ok: false, error: 'invalid' }
  return {
    ok: true,
    backup: { exportedAt: file.data.exportedAt, programs, skipped, prefs: prefs.success ? prefs.data : null },
    activeId: file.data.activeId,
  }
}

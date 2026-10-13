import { z } from 'zod'
import { Prefs, Program } from '../../domain/schema'
import { repairProgram } from '../../domain/validateProgram'
import { runMigrations, type MigrationChain } from '../../store/migrations'
import { uniqueName } from '../share/names'

export const BACKUP_FORMAT = 'tenset-backup'
/** Written before the rename to Tenset; still imported. */
const LEGACY_BACKUP_FORMAT = 'gym-builder-backup'
export const BACKUP_VERSION = 2
const MAX_BYTES = 5_000_000

// Keyed by the version a step migrates from, like the store migrations.
// v2 added optional entry notes; the bump makes older apps refuse the file instead of dropping them.
export const backupMigrations: MigrationChain = {
  1: (file) => ({ ...(file as object), version: 2 }),
}

const Envelope = z.object({
  format: z.enum([BACKUP_FORMAT, LEGACY_BACKUP_FORMAT]),
  version: z.number().int().min(1),
})

const BackupFile = z.object({
  format: z.enum([BACKUP_FORMAT, LEGACY_BACKUP_FORMAT]),
  version: z.literal(BACKUP_VERSION),
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
      targets: prefs.targets ?? {},
    },
  }
}

export function serializeBackup(backup: Backup): string {
  return `${JSON.stringify(backup, null, 2)}\n`
}

export function backupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `tenset-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

/** Names imports the way share links do: "PPL" becomes "PPL 2" when taken, also within one file. */
export function withUniqueNames(programs: readonly Program[], taken: Iterable<string>): Program[] {
  const used = [...taken]
  return programs.map((p) => {
    const name = uniqueName(p.name, used)
    used.push(name)
    return name === p.name ? p : { ...p, name }
  })
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
  const file = BackupFile.safeParse(migrated)
  if (!file.success) return { ok: false, error: 'invalid' }

  const programs: Program[] = []
  let skipped = 0
  for (const p of file.data.programs) {
    const program = repairProgram(p)
    if (program) programs.push(program)
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

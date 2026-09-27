import { describe, expect, it } from 'vitest'
import { blankProgram } from '../../domain/program'
import { defaultPrefs } from '../../store/prefs.store'
import { backupFileName, createBackup, parseBackup, serializeBackup } from './backup'

const a = blankProgram('a', 'Upper Lower', [0, 1, 3, 4])
a.days[0].entries.push({ id: 'e1', exerciseId: 101, sets: 3, reps: '8-12' })
a.custom.push({ id: 'c1', name: 'Band pull-apart', equipment: [], laterality: 'bilateral', groups: { rear_delt: 'primary' } })
const b = blankProgram('b', 'Full body', [0, 2, 4])
const prefs = { ...defaultPrefs('en-GB'), overrides: { '101': { triceps: 'primary' as const } } }

describe('backup', () => {
  it('round-trips programs and prefs', () => {
    const backup = createBackup({ programs: { a, b }, activeId: 'a' }, prefs, new Date('2026-09-26T10:00:00Z'))
    const res = parseBackup(serializeBackup(backup))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.backup.programs).toEqual([a, b])
    expect(res.backup.prefs).toEqual(prefs)
    expect(res.backup.skipped).toBe(0)
    expect(res.backup.exportedAt).toBe('2026-09-26T10:00:00.000Z')
  })

  it('rejects files that are not backups', () => {
    expect(parseBackup('nope')).toEqual({ ok: false, error: 'not_json' })
    expect(parseBackup('{"programs":[]}')).toEqual({ ok: false, error: 'wrong_file' })
    expect(parseBackup(JSON.stringify({ format: 'gym-builder-backup', version: 99 }))).toEqual({ ok: false, error: 'newer_version' })
    expect(parseBackup(JSON.stringify({ format: 'gym-builder-backup', version: 1 }))).toEqual({ ok: false, error: 'invalid' })
    expect(parseBackup('x'.repeat(5_000_001))).toEqual({ ok: false, error: 'too_large' })
  })

  it('skips invalid programs and keeps the rest', () => {
    const backup = createBackup({ programs: { a }, activeId: 'a' }, prefs)
    const text = JSON.stringify({ ...backup, programs: [a, { ...b, days: [] }], prefs: { goal: 'bulk' } })
    const res = parseBackup(text)
    expect(res.ok && res.backup.programs.length).toBe(1)
    expect(res.ok && res.backup.skipped).toBe(1)
    expect(res.ok && res.backup.prefs).toBeNull()
  })

  it('names files by date', () => {
    expect(backupFileName(new Date(2026, 0, 5))).toBe('gym-builder-2026-01-05.json')
  })
})

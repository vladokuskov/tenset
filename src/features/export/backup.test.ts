import { describe, expect, it } from 'vitest'
import { blankProgram } from '../../domain/program'
import { defaultPrefs } from '../../store/prefs.store'
import { backupFileName, createBackup, parseBackup, serializeBackup, withUniqueNames } from './backup'

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
    // Language stays with the device, so backups leave it out.
    const { locale: _locale, ...portable } = prefs
    expect(res.backup.prefs).toEqual(portable)
    expect(res.backup.skipped).toBe(0)
    expect(res.backup.exportedAt).toBe('2026-09-26T10:00:00.000Z')
  })

  it('carries entry notes and still imports v1 files', () => {
    const noted = blankProgram('n', 'Noted', [0])
    noted.days[0].entries.push({ id: 'e1', exerciseId: 101, sets: 3, note: 'seat 4' })
    const backup = createBackup({ programs: { n: noted }, activeId: 'n' }, prefs)
    expect(backup.version).toBe(2)
    const res = parseBackup(serializeBackup(backup))
    expect(res.ok && res.backup.programs[0].days[0].entries[0].note).toBe('seat 4')

    const v1 = { ...createBackup({ programs: { a }, activeId: 'a' }, prefs), version: 1 }
    const old = parseBackup(JSON.stringify(v1))
    expect(old.ok && old.backup.programs).toEqual([a])
  })

  it('still imports backups saved before the rename', () => {
    const legacy = { ...createBackup({ programs: { a }, activeId: 'a' }, prefs), format: 'gym-builder-backup' }
    const res = parseBackup(JSON.stringify(legacy))
    expect(res.ok && res.backup.programs.map((p) => p.id)).toEqual(['a'])
  })

  it('rejects files that are not backups', () => {
    expect(parseBackup('nope')).toEqual({ ok: false, error: 'not_json' })
    expect(parseBackup('{"programs":[]}')).toEqual({ ok: false, error: 'wrong_file' })
    expect(parseBackup(JSON.stringify({ format: 'gym-builder-backup', version: 99 }))).toEqual({ ok: false, error: 'newer_version' })
    expect(parseBackup(JSON.stringify({ format: 'tenset-backup', version: 3 }))).toEqual({ ok: false, error: 'newer_version' })
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

  it('skips programs whose custom exercise references do not resolve', () => {
    const dangling = blankProgram('d', 'Dangling')
    dangling.days[0].entries.push({ id: 'e1', exerciseId: 'c9', sets: 3 })
    const res = parseBackup(serializeBackup(createBackup({ programs: { a, dangling }, activeId: 'a' }, prefs)))
    expect(res.ok && res.backup.programs.map((p) => p.id)).toEqual(['a'])
    expect(res.ok && res.backup.skipped).toBe(1)
  })

  it('gives imported programs free names, like share links', () => {
    const c = blankProgram('c', 'upper lower', [0])
    const named = withUniqueNames([a, b, c], ['Upper Lower', 'Push Pull Legs'])
    expect(named.map((p) => p.name)).toEqual(['Upper Lower 2', 'Full body', 'upper lower 3'])
    expect(named[1]).toBe(b)
    expect(a.name).toBe('Upper Lower')
  })

  it('names files by date', () => {
    expect(backupFileName(new Date(2026, 0, 5))).toBe('tenset-2026-01-05.json')
  })
})

import { describe, expect, it } from 'vitest'
import { sequentialIds } from '../domain/ids.ts'
import { blankProgram } from '../domain/program.ts'
import { BENCH, CATALOG, ROW, SQUAT, TEMPLATE } from '../domain/test-fixtures.ts'
import { storageHealth } from './health.ts'
import programsV1 from './fixtures/programs.v1.json'
import { createPrefsStore, prefsStore } from './prefs.store.ts'
import { PROGRAMS_KEY, createProgramStore } from './program.store.ts'
import { listQuarantined } from './quarantine.ts'
import { memoryStorage, type SyncStorage } from './storage.ts'
import { syncAcrossTabs } from './sync.ts'

const make = (storage: SyncStorage = memoryStorage()) => ({
  storage,
  store: createProgramStore({ storage, makeId: sequentialIds('e'), newProgramId: sequentialIds('p') }),
})

const saved = (storage: SyncStorage) => JSON.parse(storage.getItem(PROGRAMS_KEY)!)

describe('program store', () => {
  it('starts empty and persists new programs with a version', () => {
    const { store, storage } = make()
    expect(store.getState().programs).toEqual({})
    const id = store.getState().createBlank('Mine', [0, 2])
    expect(store.getState().activeId).toBe(id)
    const raw = saved(storage)
    expect(raw.version).toBe(2)
    expect(Object.keys(raw.state)).toEqual(['programs', 'activeId'])
    expect(raw.state.programs[id].name).toBe('Mine')
  })

  it('edits the active program through the pure ops', () => {
    const { store } = make()
    store.getState().createBlank()
    const s = store.getState()
    s.addEntries(0, [BENCH.id, ROW.id])
    s.setSets('e1', 5)
    s.moveEntry('e2', 3)
    s.setLabel(0, 'Push')
    const p = store.getState().programs.p1
    expect(p.days[0]).toEqual({ kind: 'train', label: 'Push', entries: [{ id: 'e1', exerciseId: BENCH.id, sets: 5 }] })
    expect(p.days[3].entries).toEqual([{ id: 'e2', exerciseId: ROW.id, sets: 3 }])
  })

  it('undoes one step and only one step', () => {
    const { store } = make()
    store.getState().createBlank()
    store.getState().addEntries(0, [BENCH.id, SQUAT.id])
    store.getState().removeEntry('e1')
    expect(store.getState().lastChange?.action).toBe('removeEntry')
    expect(store.getState().undo()).toBe(true)
    expect(store.getState().programs.p1.days[0].entries.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(store.getState().undo()).toBe(false)
  })

  it('swaps several entries as one change with one undo', () => {
    const { store } = make()
    store.getState().createBlank()
    store.getState().addEntries(0, [BENCH.id, SQUAT.id])
    store.getState().swapEntries([
      { entryId: 'e1', day: 0, from: BENCH.id, to: ROW.id },
      { entryId: 'e2', day: 0, from: SQUAT.id, to: BENCH.id },
    ])
    expect(store.getState().programs.p1.days[0].entries.map((e) => e.exerciseId)).toEqual([ROW.id, BENCH.id])
    expect(store.getState().undo()).toBe(true)
    expect(store.getState().programs.p1.days[0].entries.map((e) => e.exerciseId)).toEqual([BENCH.id, SQUAT.id])
  })

  it('drops the undo snapshot when switching programs', () => {
    const { store } = make()
    const a = store.getState().createBlank('A')
    const b = store.getState().createBlank('B')
    store.getState().addEntries(0, [BENCH.id])
    store.getState().setActive(a)
    expect(store.getState().undo()).toBe(false)
    expect(store.getState().activeId).toBe(a)
    expect(store.getState().programs[b].days[0].entries).toHaveLength(1)
  })

  it('restores a deleted program with undo', () => {
    const { store } = make()
    store.getState().createBlank('A')
    store.getState().createBlank('B')
    store.getState().deleteProgram('p2')
    expect(Object.keys(store.getState().programs)).toEqual(['p1'])
    expect(store.getState().activeId).toBe('p1')
    store.getState().undo()
    expect(Object.keys(store.getState().programs)).toEqual(['p1', 'p2'])
    expect(store.getState().activeId).toBe('p2')
  })

  it('skips no-op changes so undo keeps the last real change', () => {
    const { store } = make()
    store.getState().createBlank()
    store.getState().addEntries(0, [BENCH.id])
    store.getState().removeEntry('missing')
    expect(store.getState().lastChange?.action).toBe('addEntries')
  })

  it('creates programs from templates and returns notes', () => {
    const { store } = make()
    const { id, notes } = store.getState().createFromTemplate(TEMPLATE, [0, 3], ['dumbbell'], CATALOG)
    expect(store.getState().programs[id].templateId).toBe(TEMPLATE.id)
    expect(notes.length).toBeGreaterThan(0)
  })

  it('imports shared programs as new programs and rejects invalid ones', () => {
    const { store } = make()
    const first = store.getState().createBlank('Mine')
    const id = store.getState().importProgram({ ...blankProgram(first, 'Shared') })
    expect(id).not.toBe(first)
    expect(store.getState().programs[first].name).toBe('Mine')
    expect(store.getState().programs[id!].name).toBe('Shared')
    expect(store.getState().importProgram({ nope: true })).toBeNull()
    const dangling = blankProgram('d', 'Dangling')
    dangling.days[0].entries.push({ id: 'x', exerciseId: 'c5', sets: 3 })
    expect(store.getState().importProgram(dangling)).toBeNull()
  })

  it('duplicates and renames programs', () => {
    const { store } = make()
    const id = store.getState().createBlank('Base')
    store.getState().addEntries(0, [BENCH.id])
    const copy = store.getState().duplicateProgram(id)!
    expect(store.getState().programs[copy].name).toBe('Base copy')
    store.getState().renameProgram(copy, 'Deload')
    expect(store.getState().programs[copy].name).toBe('Deload')
    expect(store.getState().programs[copy].days[0].entries).toHaveLength(1)
  })

  it('names copies in the current language and keeps the suffix within the name limit', () => {
    const { store } = make()
    const id = store.getState().createBlank('Моя програма')
    const long = store.getState().createBlank('L'.repeat(40))
    const dup = (src: string) => {
      const copy = store.getState().duplicateProgram(src)!
      return store.getState().programs[copy].name
    }
    prefsStore.setState({ locale: 'uk' })
    try {
      expect(dup(id)).toBe('Моя програма (копія)')
      expect(dup(long)).toBe(`${'L'.repeat(32)} (копія)`)
    } finally {
      prefsStore.setState({ locale: 'en' })
    }
    expect(dup(long)).toBe(`${'L'.repeat(35)} copy`)
  })

  it('manages custom exercises on the active program', () => {
    const { store } = make()
    store.getState().createBlank()
    const cid = store.getState().addCustomExercise({ name: 'Band row', equipment: [], laterality: 'bilateral', groups: { upper_back: 'primary' } })
    expect(cid).toBe('c1')
    store.getState().addEntries(1, [cid!])
    store.getState().removeCustomExercise(cid!)
    expect(store.getState().programs.p1.days[1].entries).toEqual([])
  })

  it('rehydrates valid saved state', () => {
    const storage = memoryStorage()
    const p = blankProgram('saved', 'Saved')
    storage.setItem(PROGRAMS_KEY, JSON.stringify({ state: { programs: { saved: p }, activeId: 'saved' }, version: 1 }))
    const { store } = make(storage)
    expect(store.getState().programs.saved).toEqual(p)
    expect(store.getState().activeId).toBe('saved')
  })

  it('repairs a dangling activeId and mismatched program ids', () => {
    const storage = memoryStorage()
    storage.setItem(PROGRAMS_KEY, JSON.stringify({ state: { programs: { k: blankProgram('other') }, activeId: 'gone' }, version: 1 }))
    const { store } = make(storage)
    expect(store.getState().activeId).toBe('k')
    expect(store.getState().programs.k.id).toBe('k')
  })

  it.each([
    ['broken JSON', '{"state": {'],
    ['wrong shape', JSON.stringify({ state: { programs: [1, 2], activeId: 'a' }, version: 1 })],
    ['not an object', JSON.stringify('hello')],
  ])('quarantines unreadable persisted data (%s) and starts fresh', (_label, raw) => {
    const storage = memoryStorage()
    storage.setItem(PROGRAMS_KEY, raw)
    const { store } = make(storage)
    expect(store.getState().programs).toEqual({})
    expect(store.getState().activeId).toBeNull()
    expect(listQuarantined(storage)).toHaveLength(1)
  })

  it('keeps valid programs when one is invalid and quarantines only the bad one', () => {
    const storage = memoryStorage()
    const good = blankProgram('good', 'Good')
    const bad = { ...blankProgram('bad', 'Bad'), name: 'x'.repeat(5000) }
    storage.setItem(PROGRAMS_KEY, JSON.stringify({ state: { programs: { good, bad }, activeId: 'bad' }, version: 1 }))
    const { store } = make(storage)
    expect(Object.keys(store.getState().programs)).toEqual(['good'])
    expect(store.getState().activeId).toBe('good')
    const [item] = listQuarantined(storage)
    expect(item.source).toBe(PROGRAMS_KEY)
    expect(item.data).toEqual({ programs: { bad } })
    store.getState().createBlank()
    expect(Object.keys(saved(storage).state.programs)).toEqual(['good', 'p1'])
  })

  it('never writes an empty list over stored programs that all failed validation', () => {
    const storage = memoryStorage()
    const bad = { ...blankProgram('bad'), days: [] }
    const raw = JSON.stringify({ state: { programs: { bad }, activeId: 'bad' }, version: 0 })
    storage.setItem(PROGRAMS_KEY, raw)
    const { store } = make(storage)
    expect(store.getState().programs).toEqual({})
    // the v0 migration would normally save right away
    expect(storage.getItem(PROGRAMS_KEY)).toBe(raw)
    expect(listQuarantined(storage)[0].data).toEqual({ programs: { bad } })
    store.getState().createBlank()
    store.getState().deleteProgram('p1')
    expect(saved(storage).state.programs).toEqual({})
  })

  it('keeps every quarantine under its own key and does not repeat identical ones', () => {
    const storage = memoryStorage()
    const put = (name: string) =>
      storage.setItem(PROGRAMS_KEY, JSON.stringify({ state: { programs: { x: { ...blankProgram('x'), name } } }, version: 1 }))
    put('')
    make(storage)
    make(storage)
    put('y'.repeat(41))
    make(storage)
    const items = listQuarantined(storage)
    expect(items).toHaveLength(2)
    expect(new Set(items.map((i) => i.key)).size).toBe(2)
    expect(items.every((i) => i.key.startsWith(`gb:quarantine:${PROGRAMS_KEY}:`))).toBe(true)
  })

  it('hydrates the frozen v1 fixture unchanged', () => {
    const storage = memoryStorage()
    storage.setItem(PROGRAMS_KEY, JSON.stringify(programsV1))
    const { store } = make(storage)
    expect(store.getState().programs).toEqual(programsV1.state.programs)
    expect(store.getState().activeId).toBe('z0z0z0z0z0')
    expect(listQuarantined(storage)).toEqual([])
  })

  it('swaps two whole days with moveDay', () => {
    const { store } = make()
    store.getState().createBlank('A', [0, 1, 3])
    store.getState().addEntries(0, [BENCH.id])
    store.getState().setLabel(0, 'Push')
    store.getState().setNote(2, 'Walk')
    const before = store.getState().programs.p1.days
    store.getState().moveDay(0, 2)
    const after = store.getState().programs.p1.days
    expect(after[2]).toEqual(before[0])
    expect(after[0]).toEqual(before[2])
    expect(after[1]).toBe(before[1])
    expect(store.getState().lastChange?.action).toBe('moveDay')
    store.getState().undo()
    expect(store.getState().programs.p1.days).toEqual(before)
    store.getState().moveDay(1, 1)
    store.getState().moveDay(1, 9)
    expect(store.getState().programs.p1.days).toEqual(before)
  })

  it('reloads when another tab writes, so neither tab overwrites the other', () => {
    const storage = memoryStorage()
    const tabA = make(storage).store
    const tabB = createProgramStore({ storage, makeId: sequentialIds('f'), newProgramId: sequentialIds('q') })
    const windowB = new EventTarget()
    const stop = syncAcrossTabs(windowB as unknown as Window, tabB, createPrefsStore({ storage }))
    const storageEvent = (key: string | null) => windowB.dispatchEvent(Object.assign(new Event('storage'), { key }))

    tabB.getState().createBlank('Made in tab B')
    tabB.getState().addEntries(0, [BENCH.id])
    storageEvent(PROGRAMS_KEY)
    tabA.persist.rehydrate()
    tabA.getState().createBlank('Made in tab A')
    storageEvent(PROGRAMS_KEY)
    expect(tabB.getState().lastChange).toBeNull()
    expect(tabB.getState().undo()).toBe(false)
    tabB.getState().renameProgram('q1', 'Renamed in tab B')
    const names = Object.values(saved(storage).state.programs as Record<string, { name: string }>).map((p) => p.name)
    expect(names).toEqual(['Renamed in tab B', 'Made in tab A'])

    storage.removeItem(PROGRAMS_KEY)
    storageEvent(null)
    expect(tabB.getState().programs).toEqual({})
    stop()
  })

  it('loads a saved program with a custom reference that does not resolve, without that entry', () => {
    const storage = memoryStorage()
    const p = blankProgram('old', 'Old')
    p.days[0].entries.push({ id: 'e1', exerciseId: 'c1', sets: 3 }, { id: 'e2', exerciseId: BENCH.id, sets: 3 })
    storage.setItem(PROGRAMS_KEY, JSON.stringify({ state: { programs: { old: p }, activeId: 'old' }, version: 2 }))
    const { store } = make(storage)
    expect(store.getState().programs.old.days[0].entries.map((e) => e.id)).toEqual(['e2'])
    expect(listQuarantined(storage)).toEqual([])
  })

  it('writes a delete to zero programs once another tab brought valid ones in over unreadable data', () => {
    const storage = memoryStorage()
    storage.setItem(PROGRAMS_KEY, JSON.stringify({ state: { programs: { bad: { nope: true } }, activeId: 'bad' }, version: 2 }))
    const tabA = make(storage).store
    const tabB = createProgramStore({ storage, makeId: sequentialIds('f'), newProgramId: sequentialIds('q') })
    expect(tabA.getState().programs).toEqual({})
    tabB.getState().createBlank('Made in tab B')
    tabA.persist.rehydrate()
    expect(Object.keys(tabA.getState().programs)).toEqual(['q1'])
    tabA.getState().deleteProgram('q1')
    expect(saved(storage).state.programs).toEqual({})
    expect(make(storage).store.getState().programs).toEqual({})
  })

  it('migrates v0 state through the chain', () => {
    const storage = memoryStorage()
    const p = blankProgram('old', 'Old')
    storage.setItem(PROGRAMS_KEY, JSON.stringify({ state: { programs: { old: p }, activeId: 'old' }, version: 0 }))
    const { store } = make(storage)
    expect(store.getState().programs.old).toEqual(p)
    expect(saved(storage).version).toBe(2)
  })

  it('migrates v1 state to v2 and keeps entry notes from then on', () => {
    const storage = memoryStorage()
    const p = blankProgram('old', 'Old')
    p.days[0].entries.push({ id: 'e1', exerciseId: BENCH.id, sets: 3, rir: 2 })
    storage.setItem(PROGRAMS_KEY, JSON.stringify({ state: { programs: { old: p }, activeId: 'old' }, version: 1 }))
    const { store } = make(storage)
    expect(store.getState().programs.old).toEqual(p)
    store.getState().setEntryNote('e1', 'seat 4')
    expect(saved(storage).version).toBe(2)
    expect(saved(storage).state.programs.old.days[0].entries[0]).toEqual({ id: 'e1', exerciseId: BENCH.id, sets: 3, rir: 2, note: 'seat 4' })
    expect(make(storage).store.getState().programs.old.days[0].entries[0].note).toBe('seat 4')
    store.getState().undo()
    expect(store.getState().programs.old.days[0].entries[0]).not.toHaveProperty('note')
  })

  it('stops saving when a newer version of the app saved here, so its fields survive', () => {
    storageHealth.setState({ newerVersion: false })
    const storage = memoryStorage()
    const p = blankProgram('new', 'New')
    const newer = JSON.stringify({ state: { programs: { new: { ...p, extra: 'kept' } }, activeId: 'new' }, version: 99 })
    storage.setItem(PROGRAMS_KEY, newer)
    const { store } = make(storage)
    store.getState().createBlank('Stale tab')
    expect(storage.getItem(PROGRAMS_KEY)).toBe(newer)
    expect(storageHealth.getState().newerVersion).toBe(true)
  })

  it('works when storage throws and reports the failed write', () => {
    storageHealth.setState({ writeFailed: false })
    const throwing: SyncStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {},
    }
    const { store } = make(throwing)
    store.getState().createBlank()
    expect(Object.keys(store.getState().programs)).toEqual(['p1'])
    expect(storageHealth.getState().writeFailed).toBe(true)
  })
})

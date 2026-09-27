import { describe, expect, it } from 'vitest'
import { sequentialIds } from '../domain/ids.ts'
import { blankProgram } from '../domain/program.ts'
import { BENCH, CATALOG, ROW, SQUAT, TEMPLATE } from '../domain/test-fixtures.ts'
import { PROGRAMS_KEY, createProgramStore } from './program.store.ts'
import { memoryStorage, type SyncStorage } from './storage.ts'

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
    expect(raw.version).toBe(1)
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
    ['wrong shape', JSON.stringify({ state: { programs: { a: { id: 'a', name: 'A', days: [], custom: [] } }, activeId: 'a' }, version: 1 })],
    ['not an object', JSON.stringify('hello')],
    ['bad entry', JSON.stringify({ state: { programs: { a: { ...blankProgram('a'), days: blankProgram('a').days.map((d) => ({ ...d, entries: [{ id: 'x', exerciseId: 0, sets: 3 }] })) } }, activeId: 'a' }, version: 1 })],
  ])('rejects corrupt persisted data (%s), starts fresh and keeps a backup', (_label, raw) => {
    const storage = memoryStorage()
    storage.setItem(PROGRAMS_KEY, raw)
    const { store } = make(storage)
    expect(store.getState().programs).toEqual({})
    expect(store.getState().activeId).toBeNull()
    expect(storage.getItem(`${PROGRAMS_KEY}:corrupt`)).not.toBeNull()
    store.getState().createBlank()
    expect(Object.keys(saved(storage).state.programs)).toEqual(['p1'])
  })

  it('migrates v0 state through the chain', () => {
    const storage = memoryStorage()
    const p = blankProgram('old', 'Old')
    storage.setItem(PROGRAMS_KEY, JSON.stringify({ state: { programs: { old: p }, activeId: 'old' }, version: 0 }))
    const { store } = make(storage)
    expect(store.getState().programs.old).toEqual(p)
    expect(saved(storage).version).toBe(1)
  })

  it('works when storage throws', () => {
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
  })
})

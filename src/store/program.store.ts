import { z } from 'zod'
import { useStore } from 'zustand'
import { persist } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'
import { appMessages } from '../app/messages.ts'
import { randomId, type IdFactory } from '../domain/ids.ts'
import * as ops from '../domain/program.ts'
import type { Catalog } from '../domain/resolve.ts'
import { Program, type ExerciseRef, type SplitTemplate } from '../domain/schema.ts'
import { getMessages } from '../i18n/messages.ts'
import { PROGRAMS_VERSION, programMigrations, runMigrations } from './migrations/index.ts'
import { backupCorrupt, browserStorage, safeJSONStorage, type SyncStorage } from './storage.ts'

export const PROGRAMS_KEY = 'gb:programs'

export const PersistedPrograms = z.object({
  programs: z.record(z.string(), Program),
  activeId: z.string().nullable(),
})
export type PersistedPrograms = z.infer<typeof PersistedPrograms>

export type UndoSnapshot = { action: string; programs: Record<string, Program>; activeId: string | null }

type Day = number

export type ProgramActions = {
  createBlank(name?: string, trainingDays?: readonly Day[]): string
  createFromTemplate(
    template: SplitTemplate,
    trainingDays: readonly Day[] | undefined,
    available: Iterable<string>,
    catalog: Catalog,
  ): { id: string; notes: ops.TemplateNote[] }
  /** Share links and JSON imports always become a new program. Returns null for invalid data. */
  importProgram(program: unknown): string | null
  duplicateProgram(id: string): string | null
  setActive(id: string): void
  renameProgram(id: string, name: string): void
  deleteProgram(id: string): void

  addEntries(day: Day, refs: readonly ExerciseRef[], sets?: number, reps?: string): void
  removeEntry(entryId: string): void
  moveEntry(entryId: string, toDay: Day, toIndex?: number): void
  copyEntry(entryId: string, toDay: Day): void
  reorder(day: Day, from: number, to: number): void
  swapEntry(entryId: string, ref: ExerciseRef): void
  setSets(entryId: string, sets: number): void
  setReps(entryId: string, reps: string | undefined): void
  duplicateDay(from: Day, to: Day): void
  clearDay(day: Day): void
  setRest(day: Day): void
  setTrain(day: Day): void
  setLabel(day: Day, label: string | undefined): void
  setNote(day: Day, note: string | undefined): void
  addCustomExercise(input: ops.CustomExerciseInput): string | null
  updateCustomExercise(id: string, patch: Partial<ops.CustomExerciseInput>): void
  removeCustomExercise(id: string): void

  /** Restores the state before the last change. Returns false when there is nothing to undo. */
  undo(): boolean
  clearUndo(): void
}

export type ProgramState = PersistedPrograms & {
  /** One-step snapshot taken before the last change (not persisted). */
  lastChange: UndoSnapshot | null
} & ProgramActions

export type ProgramStoreOptions = {
  storage?: SyncStorage
  makeId?: IdFactory
  newProgramId?: IdFactory
}

function normalize(data: PersistedPrograms): PersistedPrograms {
  const programs: Record<string, Program> = {}
  for (const [key, p] of Object.entries(data.programs)) programs[key] = p.id === key ? p : { ...p, id: key }
  const activeId = data.activeId && programs[data.activeId] ? data.activeId : (Object.keys(programs)[0] ?? null)
  return { programs, activeId }
}

export function createProgramStore(options: ProgramStoreOptions = {}) {
  const storage = options.storage ?? browserStorage()
  const makeId = options.makeId ?? (() => randomId(8))
  const newProgramId = options.newProgramId ?? (() => randomId(10))

  return createStore<ProgramState>()(
    persist(
      (set, get) => {
        const commit = (action: string, programs: Record<string, Program>, activeId: string | null) => {
          const prev = get()
          set({ programs, activeId, lastChange: { action, programs: prev.programs, activeId: prev.activeId } })
        }

        const addProgram = (action: string, program: Program) => {
          commit(action, { ...get().programs, [program.id]: program }, program.id)
          return program.id
        }

        const mutate = (action: string, fn: (p: Program) => Program) => {
          const { programs, activeId } = get()
          const current = activeId ? programs[activeId] : undefined
          if (!activeId || !current) return
          const next = fn(current)
          if (next !== current) commit(action, { ...programs, [activeId]: next }, activeId)
        }

        return {
          programs: {},
          activeId: null,
          lastChange: null,

          createBlank: (name = getMessages(appMessages).defaultProgramName, trainingDays) =>
            addProgram('createBlank', ops.blankProgram(newProgramId(), name, trainingDays)),

          createFromTemplate: (template, trainingDays, available, catalog) => {
            const { program, notes } = ops.applyTemplate(template, trainingDays, available, catalog, {
              id: newProgramId(),
              makeId,
            })
            return { id: addProgram('createFromTemplate', program), notes }
          },

          importProgram: (raw) => {
            const parsed = Program.safeParse(raw)
            if (!parsed.success) return null
            return addProgram('importProgram', { ...parsed.data, id: newProgramId() })
          },

          duplicateProgram: (id) => {
            const src = get().programs[id]
            if (!src) return null
            const copy = structuredClone(src)
            return addProgram('duplicateProgram', ops.rename({ ...copy, id: newProgramId() }, `${src.name} copy`.slice(0, ops.NAME_MAX)))
          },

          // Switching drops the undo snapshot so Undo never edits a program that is not on screen.
          setActive: (id) => {
            if (get().programs[id] && id !== get().activeId) set({ activeId: id, lastChange: null })
          },

          renameProgram: (id, name) => {
            const { programs, activeId } = get()
            const p = programs[id]
            if (!p) return
            const next = ops.rename(p, name)
            if (next !== p) commit('renameProgram', { ...programs, [id]: next }, activeId)
          },

          deleteProgram: (id) => {
            const { programs, activeId } = get()
            if (!programs[id]) return
            const { [id]: _removed, ...rest } = programs
            commit('deleteProgram', rest, activeId === id ? (Object.keys(rest)[0] ?? null) : activeId)
          },

          addEntries: (day, refs, sets, reps) => mutate('addEntries', (p) => ops.addEntries(p, day, refs, makeId, sets, reps)),
          removeEntry: (entryId) => mutate('removeEntry', (p) => ops.removeEntry(p, entryId)),
          moveEntry: (entryId, toDay, toIndex) => mutate('moveEntry', (p) => ops.moveEntry(p, entryId, toDay, toIndex)),
          copyEntry: (entryId, toDay) => mutate('copyEntry', (p) => ops.copyEntry(p, entryId, toDay, makeId)),
          reorder: (day, from, to) => mutate('reorder', (p) => ops.reorder(p, day, from, to)),
          swapEntry: (entryId, ref) => mutate('swapEntry', (p) => ops.swapEntry(p, entryId, ref)),
          setSets: (entryId, sets) => mutate('setSets', (p) => ops.setSets(p, entryId, sets)),
          setReps: (entryId, reps) => mutate('setReps', (p) => ops.setReps(p, entryId, reps)),
          duplicateDay: (from, to) => mutate('duplicateDay', (p) => ops.duplicateDay(p, from, to, makeId)),
          clearDay: (day) => mutate('clearDay', (p) => ops.clearDay(p, day)),
          setRest: (day) => mutate('setRest', (p) => ops.setRest(p, day)),
          setTrain: (day) => mutate('setTrain', (p) => ops.setTrain(p, day)),
          setLabel: (day, label) => mutate('setLabel', (p) => ops.setLabel(p, day, label)),
          setNote: (day, note) => mutate('setNote', (p) => ops.setNote(p, day, note)),

          addCustomExercise: (input) => {
            let id: string | null = null
            mutate('addCustomExercise', (p) => {
              const res = ops.addCustomExercise(p, input)
              if (!res) return p
              id = res.id
              return res.program
            })
            return id
          },
          updateCustomExercise: (id, patch) => mutate('updateCustomExercise', (p) => ops.updateCustomExercise(p, id, patch)),
          removeCustomExercise: (id) => mutate('removeCustomExercise', (p) => ops.removeCustomExercise(p, id)),

          undo: () => {
            const snap = get().lastChange
            if (!snap) return false
            set({ programs: snap.programs, activeId: snap.activeId, lastChange: null })
            return true
          },
          clearUndo: () => set({ lastChange: null }),
        }
      },
      {
        name: PROGRAMS_KEY,
        version: PROGRAMS_VERSION,
        storage: safeJSONStorage<PersistedPrograms>(storage),
        partialize: (s) => ({ programs: s.programs, activeId: s.activeId }),
        migrate: (state, version) => {
          try {
            return runMigrations(state, version, PROGRAMS_VERSION, programMigrations) as PersistedPrograms
          } catch {
            return state as PersistedPrograms
          }
        },
        merge: (persisted, current) => {
          if (persisted === undefined || persisted === null) return current
          const parsed = PersistedPrograms.safeParse(persisted)
          if (!parsed.success) {
            backupCorrupt(storage, PROGRAMS_KEY, JSON.stringify(persisted))
            return current
          }
          return { ...current, ...normalize(parsed.data) }
        },
      },
    ),
  )
}

export const programStore = createProgramStore()

export function useProgramStore<T>(selector: (s: ProgramState) => T): T {
  return useStore(programStore, selector)
}

export function useActiveProgram(): Program | null {
  return useProgramStore((s) => (s.activeId ? (s.programs[s.activeId] ?? null) : null))
}

import { availableSet, hasEquipment } from './equipment.ts'
import type { IdFactory } from './ids.ts'
import type { Catalog } from './resolve.ts'
import type { CustomExercise, Day, Entry, Exercise, ExerciseRef, Program, SplitTemplate } from './schema.ts'

export const DEFAULT_SETS = 3
export const MAX_SETS = 20
export const MAX_CUSTOM = 30
export const MAX_CUSTOM_ID = 63
export const LABEL_MAX = 24
export const NOTE_MAX = 80
export const NAME_MAX = 40
export const DEFAULT_PROGRAM_NAME = 'My program'
export const REST_STEP = 15
export const REST_MAX = 600
export const RIR_MAX = 5

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

type DayIndex = number

export function blankProgram(id: string, name = DEFAULT_PROGRAM_NAME, trainingDays: readonly DayIndex[] = ALL_DAYS): Program {
  return {
    id,
    name: cleanName(name) ?? DEFAULT_PROGRAM_NAME,
    days: ALL_DAYS.map((d) => ({ kind: trainingDays.includes(d) ? 'train' : 'rest', entries: [] })),
    custom: [],
  }
}

const clampSets = (sets: number) => Math.min(MAX_SETS, Math.max(1, Math.round(sets) || 1))

const cleanText = (text: string | undefined, max: number) => {
  const t = text?.trim().slice(0, max)
  return t ? t : undefined
}

const cleanName = (name: string) => cleanText(name, NAME_MAX)

function updateDay(program: Program, day: DayIndex, fn: (d: Day) => Day): Program {
  if (!program.days[day]) return program
  return { ...program, days: program.days.map((d, i) => (i === day ? fn(d) : d)) }
}

function findEntry(program: Program, entryId: string): { day: DayIndex; index: number; entry: Entry } | null {
  for (let day = 0; day < program.days.length; day++) {
    const index = program.days[day].entries.findIndex((e) => e.id === entryId)
    if (index >= 0) return { day, index, entry: program.days[day].entries[index] }
  }
  return null
}

function updateEntry(program: Program, entryId: string, fn: (e: Entry) => Entry): Program {
  const found = findEntry(program, entryId)
  if (!found) return program
  return updateDay(program, found.day, (d) => ({
    ...d,
    entries: d.entries.map((e) => (e.id === entryId ? fn(e) : e)),
  }))
}

const unlinked = ({ withPrev: _drop, ...e }: Entry): Entry => e

/** Pairs only: the first entry and an entry whose predecessor is already paired cannot link up. */
export function normalizeSupersets(entries: readonly Entry[]): Entry[] {
  let changed = false
  const out: Entry[] = []
  entries.forEach((e, i) => {
    const orphan = e.withPrev && (i === 0 || out[i - 1].withPrev)
    if (orphan) changed = true
    out.push(orphan ? unlinked(e) : e)
  })
  return changed ? out : (entries as Entry[])
}

/** Repairs superset flags on every day, for data that did not come through these ops. */
export function normalizeProgramSupersets(program: Program): Program {
  let changed = false
  const days = program.days.map((d) => {
    const entries = normalizeSupersets(d.entries)
    if (entries === d.entries) return d
    changed = true
    return { ...d, entries }
  })
  return changed ? { ...program, days } : program
}

/** True when the entry is the first or second half of a superset. */
export function inSuperset(entries: readonly Entry[], index: number): boolean {
  return !!entries[index]?.withPrev || !!entries[index + 1]?.withPrev
}

/** Takes the entry at index out of its pair, so moving or removing it leaves no half-pair behind. */
function detach(entries: readonly Entry[], index: number): Entry[] {
  return entries.map((e, i) => (i === index || (i === index + 1 && e.withPrev) ? unlinked(e) : e))
}

/** An entry inserted at index must not end up between the two halves of a pair. */
function insertAt(entries: readonly Entry[], index: number, entry: Entry): Entry[] {
  const next = [...entries]
  next.splice(index, 0, unlinked(entry))
  if (next[index + 1]?.withPrev) next[index + 1] = unlinked(next[index + 1])
  return normalizeSupersets(next)
}

function withReps(entry: Entry, reps: string | undefined): Entry {
  const { reps: _drop, ...rest } = entry
  const clean = cleanText(reps, 16)
  return clean ? { ...rest, reps: clean } : rest
}

/** Adding to a rest day turns it into a training day. */
export function addEntries(
  program: Program,
  day: DayIndex,
  refs: readonly ExerciseRef[],
  makeId: IdFactory,
  sets = DEFAULT_SETS,
  reps?: string,
): Program {
  if (refs.length === 0) return program
  const added = refs.map((ref) => withReps({ id: makeId(), exerciseId: ref, sets: clampSets(sets) }, reps))
  return updateDay(program, day, (d) => ({ ...d, kind: 'train', entries: [...d.entries, ...added] }))
}

/** Removing either half of a superset dissolves the pair. */
export function removeEntry(program: Program, entryId: string): Program {
  const found = findEntry(program, entryId)
  if (!found) return program
  return updateDay(program, found.day, (d) => ({
    ...d,
    entries: normalizeSupersets(detach(d.entries, found.index).filter((e) => e.id !== entryId)),
  }))
}

/** A moved entry leaves its superset. */
export function moveEntry(program: Program, entryId: string, toDay: DayIndex, toIndex?: number): Program {
  const found = findEntry(program, entryId)
  if (!found || !program.days[toDay]) return program
  const without = removeEntry(program, entryId)
  return updateDay(without, toDay, (d) => ({
    ...d,
    kind: 'train',
    entries: insertAt(d.entries, toIndex ?? d.entries.length, found.entry),
  }))
}

export function copyEntry(program: Program, entryId: string, toDay: DayIndex, makeId: IdFactory): Program {
  const found = findEntry(program, entryId)
  if (!found || !program.days[toDay]) return program
  const copy = unlinked({ ...found.entry, id: makeId() })
  return updateDay(program, toDay, (d) => ({ ...d, kind: 'train', entries: [...d.entries, copy] }))
}

/** A reordered entry leaves its superset. */
export function reorder(program: Program, day: DayIndex, from: number, to: number): Program {
  const entries = program.days[day]?.entries
  if (!entries || from < 0 || from >= entries.length || from === to) return program
  const next = detach(entries, from)
  const [moved] = next.splice(from, 1)
  const placed = insertAt(normalizeSupersets(next), Math.max(0, Math.min(to, next.length)), moved)
  return updateDay(program, day, (d) => ({ ...d, entries: placed }))
}

export function swapEntry(program: Program, entryId: string, ref: ExerciseRef): Program {
  return updateEntry(program, entryId, (e) => ({ ...e, exerciseId: ref }))
}

export function setSets(program: Program, entryId: string, sets: number): Program {
  return updateEntry(program, entryId, (e) => ({ ...e, sets: clampSets(sets) }))
}

export function setReps(program: Program, entryId: string, reps: string | undefined): Program {
  return updateEntry(program, entryId, (e) => withReps(e, reps))
}

export const clampRest = (sec: number) =>
  Math.min(REST_MAX, Math.max(0, Math.round((Number.isFinite(sec) ? sec : 0) / REST_STEP) * REST_STEP))

/** Undefined clears it, so the estimate falls back to the default for the exercise. */
export function setRestSec(program: Program, entryId: string, sec: number | undefined): Program {
  return updateEntry(program, entryId, ({ restSec: _drop, ...e }) => (sec === undefined ? e : { ...e, restSec: clampRest(sec) }))
}

export function setRir(program: Program, entryId: string, rir: number | undefined): Program {
  return updateEntry(program, entryId, ({ rir: _drop, ...e }) =>
    rir === undefined || !Number.isFinite(rir) ? e : { ...e, rir: Math.min(RIR_MAX, Math.max(0, Math.round(rir))) },
  )
}

/** Whether the entry can be paired with the one above it. */
export function canLinkWithPrev(entries: readonly Entry[], index: number): boolean {
  return index > 0 && index < entries.length && !entries[index].withPrev && !inSuperset(entries, index - 1) && !entries[index + 1]?.withPrev
}

export function linkWithPrev(program: Program, entryId: string, on: boolean): Program {
  const found = findEntry(program, entryId)
  if (!found) return program
  const entries = program.days[found.day].entries
  if (!on) return found.entry.withPrev ? updateEntry(program, entryId, unlinked) : program
  if (!canLinkWithPrev(entries, found.index)) return program
  return updateEntry(program, entryId, (e) => ({ ...e, withPrev: true }))
}

/** Replaces the target day with a copy of the source day (fresh entry ids). */
export function duplicateDay(program: Program, from: DayIndex, to: DayIndex, makeId: IdFactory): Program {
  const src = program.days[from]
  if (!src || !program.days[to] || from === to) return program
  return updateDay(program, to, () => ({ ...src, entries: src.entries.map((e) => ({ ...e, id: makeId() })) }))
}

export function clearDay(program: Program, day: DayIndex): Program {
  return updateDay(program, day, (d) => ({ ...d, entries: [] }))
}

/** Entries stay on a rest day (restored by setTrain) but never count. */
export function setRest(program: Program, day: DayIndex): Program {
  return updateDay(program, day, (d) => ({ ...d, kind: 'rest' }))
}

export function setTrain(program: Program, day: DayIndex): Program {
  return updateDay(program, day, (d) => ({ ...d, kind: 'train' }))
}

export function setLabel(program: Program, day: DayIndex, label: string | undefined): Program {
  return updateDay(program, day, ({ label: _drop, ...d }) => {
    const clean = cleanText(label, LABEL_MAX)
    return clean ? { ...d, label: clean } : d
  })
}

export function setNote(program: Program, day: DayIndex, note: string | undefined): Program {
  return updateDay(program, day, ({ note: _drop, ...d }) => {
    const clean = cleanText(note, NOTE_MAX)
    return clean ? { ...d, note: clean } : d
  })
}

/** Blank names are ignored. */
export function rename(program: Program, name: string): Program {
  const clean = cleanName(name)
  return clean ? { ...program, name: clean } : program
}

export type CustomExerciseInput = Omit<CustomExercise, 'id'>

/** Returns null when the program already holds the maximum number of custom exercises. */
export function addCustomExercise(program: Program, input: CustomExerciseInput): { program: Program; id: string } | null {
  if (program.custom.length >= MAX_CUSTOM) return null
  const used = new Set(program.custom.map((c) => c.id))
  let n = 1
  while (used.has(`c${n}`)) n++
  if (n > MAX_CUSTOM_ID) return null
  const id = `c${n}`
  const name = input.name.trim().slice(0, NAME_MAX) || 'Custom exercise'
  return { program: { ...program, custom: [...program.custom, { ...input, name, id }] }, id }
}

export function updateCustomExercise(program: Program, id: string, patch: Partial<CustomExerciseInput>): Program {
  if (!program.custom.some((c) => c.id === id)) return program
  return {
    ...program,
    custom: program.custom.map((c) => {
      if (c.id !== id) return c
      const next = { ...c, ...patch, id }
      return { ...next, name: next.name.trim().slice(0, NAME_MAX) || c.name }
    }),
  }
}

/** Also removes every entry that uses it. */
export function removeCustomExercise(program: Program, id: string): Program {
  return {
    ...program,
    custom: program.custom.filter((c) => c.id !== id),
    days: program.days.map((d) => {
      let entries = d.entries
      d.entries.forEach((e, i) => {
        if (e.exerciseId === id) entries = detach(entries, i)
      })
      return { ...d, entries: normalizeSupersets(entries.filter((e) => e.exerciseId !== id)) }
    }),
  }
}

/** Structured; the UI puts them into words. */
export type TemplateNote =
  | { kind: 'dropped_slot'; day: DayIndex; session: string; slot: number; pattern: string; group: string }
  | { kind: 'day_count'; expected: number; got: number }

export type ApplyTemplateOptions = {
  id: string
  makeId: IdFactory
  name?: string
}

/** Follows replacedBy links of retired records; null when the chain ends nowhere usable. */
export function activeExercise(catalog: Catalog, id: number): Exercise | null {
  const seen = new Set<number>()
  let ex = catalog.get(id)
  while (ex && ex.status === 'retired') {
    if (ex.replacedBy === null || seen.has(ex.id)) return null
    seen.add(ex.id)
    ex = catalog.get(ex.replacedBy)
  }
  return ex ?? null
}

/**
 * Sessions go onto the training days in order (cycling if there are more days than sessions).
 * Each slot takes the first option the equipment allows; slots with no usable option are dropped with a note.
 */
export function applyTemplate(
  template: SplitTemplate,
  trainingDays: readonly DayIndex[] | undefined,
  available: Iterable<string>,
  catalog: Catalog,
  opts: ApplyTemplateOptions,
): { program: Program; notes: TemplateNote[] } {
  const days = [...new Set(trainingDays?.length ? trainingDays : template.defaultDays)]
    .filter((d) => d >= 0 && d <= 6)
    .sort((a, b) => a - b)
  const avail = availableSet(available)
  const notes: TemplateNote[] = []
  if (days.length !== template.daysPerWeek) {
    notes.push({ kind: 'day_count', expected: template.daysPerWeek, got: days.length })
  }

  const program = blankProgram(opts.id, opts.name ?? template.name, days)
  program.templateId = template.id
  if (template.sessions.length === 0) return { program, notes }

  days.forEach((day, i) => {
    const session = template.sessions[i % template.sessions.length]
    const entries: Entry[] = []
    session.slots.forEach((slot, slotIndex) => {
      const pick = slot.options
        .map((o) => activeExercise(catalog, o))
        .find((ex) => ex !== null && hasEquipment(ex, avail))
      if (!pick) {
        notes.push({
          kind: 'dropped_slot',
          day,
          session: session.label,
          slot: slotIndex,
          pattern: slot.pattern,
          group: slot.group,
        })
        return
      }
      entries.push(withReps({ id: opts.makeId(), exerciseId: pick.id, sets: clampSets(slot.sets) }, slot.reps))
    })
    const label = cleanText(session.label, LABEL_MAX)
    program.days[day] = label ? { kind: 'train', label, entries } : { kind: 'train', entries }
  })

  return { program, notes }
}

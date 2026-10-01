import { CODEC_EQUIPMENT_V1, CODEC_GROUPS_V1, REPS_PRESETS, decodeProgram, encodeProgram } from '../../src/domain/codec.ts'
import { equipment, hasEquipment } from '../../src/domain/equipment.ts'
import { sequentialIds } from '../../src/domain/ids.ts'
import { LABEL_MAX, MAX_CUSTOM, MAX_SETS, NAME_MAX, NOTE_MAX } from '../../src/domain/program.ts'
import { isCustomRef } from '../../src/domain/resolve.ts'
import { Pattern, Program, type CustomExercise, type Day, type Exercise, type ExerciseRef } from '../../src/domain/schema.ts'
import { groups } from '../../src/domain/taxonomy.ts'
import { bandFor, computeWeek } from '../../src/domain/volume.ts'
import { catalog, exercises, replacedBy, splits } from './catalog.ts'

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

export type EntryInput = { exerciseId: ExerciseRef; sets: number; reps?: string }
export type DayInput = { day: number; label?: string; note?: string; entries: EntryInput[] }
export type ProgramInput = { name: string; days: DayInput[]; custom?: CustomExercise[] }

export class ToolError extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(problems.join('\n'))
    this.problems = problems
  }
}

const brief = (e: Exercise) => ({
  id: e.id,
  name: e.name,
  pattern: e.pattern,
  mechanic: e.mechanic,
  equipment: e.equipment,
  groups: e.groups,
  unit: e.unit,
  defaults: e.defaults,
})

export type SearchInput = { query?: string; group?: string; pattern?: string; equipment?: string[]; limit?: number }

export function searchExercises({ query, group, pattern, equipment: available, limit = 200 }: SearchInput) {
  const words = query?.toLowerCase().split(/\s+/).filter(Boolean) ?? []
  const matches = exercises.filter((e) => {
    if (e.status !== 'active') return false
    if (group && !e.groups[group]) return false
    if (pattern && e.pattern !== pattern) return false
    if (available && !hasEquipment(e, available)) return false
    const haystack = [e.name, e.slug, ...e.aliases].join(' ').toLowerCase()
    return words.every((w) => haystack.includes(w))
  })
  if (group) matches.sort((a, b) => (a.groups[group] === b.groups[group] ? 0 : a.groups[group] === 'primary' ? -1 : 1))
  return { count: matches.length, exercises: matches.slice(0, limit).map(brief) }
}

export function getReference() {
  return {
    days: DAY_NAMES.map((name, day) => ({ day, name })),
    muscleGroups: groups.map((g) => ({ id: g.id, name: g.name, area: g.area, banded: g.banded })),
    equipment: equipment.map((e) => ({ id: e.id, name: e.name })),
    patterns: Pattern.options,
    repsPresets: REPS_PRESETS,
    limits: { nameMax: NAME_MAX, labelMax: LABEL_MAX, noteMax: NOTE_MAX, setsMax: MAX_SETS, customMax: MAX_CUSTOM },
  }
}

const exerciseName = (id: number) => catalog.get(id)?.name ?? `#${id}`

export function listSplits() {
  return splits.map((s) => ({
    id: s.id,
    name: s.name,
    level: s.level,
    daysPerWeek: s.daysPerWeek,
    description: s.description,
    defaultDays: s.defaultDays,
    sessions: s.sessions.map((session) => ({
      label: session.label,
      slots: session.slots.map((slot) => ({
        group: slot.group,
        pattern: slot.pattern,
        sets: slot.sets,
        reps: slot.reps,
        options: slot.options.map((id) => ({ id, name: exerciseName(id) })),
      })),
    })),
  }))
}

function checkCustom(custom: readonly CustomExercise[], problems: string[]) {
  const seen = new Set<string>()
  for (const c of custom) {
    if (seen.has(c.id)) problems.push(`custom exercise id ${c.id} is used twice`)
    seen.add(c.id)
    for (const e of c.equipment) {
      if (!(CODEC_EQUIPMENT_V1 as readonly string[]).includes(e)) problems.push(`custom ${c.id}: unknown equipment "${e}"`)
    }
    for (const g of Object.keys(c.groups)) {
      if (!(CODEC_GROUPS_V1 as readonly string[]).includes(g)) problems.push(`custom ${c.id}: unknown muscle group "${g}"`)
    }
    if (Object.keys(c.groups).length === 0) problems.push(`custom ${c.id}: needs at least one muscle group`)
  }
  return seen
}

function checkRef(ref: ExerciseRef, where: string, customIds: Set<string>, problems: string[]) {
  if (isCustomRef(ref)) {
    if (!customIds.has(ref)) problems.push(`${where}: custom exercise ${ref} is not defined in "custom"`)
    return
  }
  const ex = catalog.get(ref)
  if (!ex) problems.push(`${where}: exerciseId ${ref} does not exist, use search_exercises to find ids`)
  else if (ex.status !== 'active') {
    const next = ex.replacedBy ? `, use ${ex.replacedBy} (${exerciseName(ex.replacedBy)}) instead` : ''
    problems.push(`${where}: exerciseId ${ref} (${ex.name}) is retired${next}`)
  }
}

export function buildProgram(input: ProgramInput): Program {
  const problems: string[] = []
  const custom = input.custom ?? []
  const customIds = checkCustom(custom, problems)
  const makeId = sequentialIds('e')
  const days: Day[] = DAY_NAMES.map(() => ({ kind: 'rest', entries: [] }))
  const seenDays = new Set<number>()

  for (const d of input.days) {
    const dayName = DAY_NAMES[d.day] ?? `day ${d.day}`
    if (seenDays.has(d.day)) problems.push(`${dayName} is listed twice`)
    seenDays.add(d.day)
    d.entries.forEach((e, i) => checkRef(e.exerciseId, `${dayName} entry ${i + 1}`, customIds, problems))
    const day: Day = {
      kind: 'train',
      entries: d.entries.map((e) => ({ id: makeId(), exerciseId: e.exerciseId, sets: e.sets, ...(e.reps ? { reps: e.reps } : {}) })),
    }
    if (d.label?.trim()) day.label = d.label.trim()
    if (d.note?.trim()) day.note = d.note.trim()
    days[d.day] = day
  }

  const parsed = Program.safeParse({ id: 'shared', name: input.name.trim(), days, custom })
  if (!parsed.success) for (const i of parsed.error.issues) problems.push(`${i.path.join('.') || 'program'}: ${i.message}`)
  if (problems.length) throw new ToolError(problems)
  return parsed.data!
}

function summarize(program: Program) {
  const week = computeWeek(program, { catalog, prefs: { countingMode: 'fractional', overrides: {} } })
  const customName = new Map(program.custom.map((c) => [c.id, c.name]))
  const nameOf = (ref: ExerciseRef) => (isCustomRef(ref) ? (customName.get(ref) ?? ref) : exerciseName(ref))
  const defaultReps = (ref: ExerciseRef) => (isCustomRef(ref) ? 'default reps' : (catalog.get(ref)?.defaults.reps ?? 'default reps'))
  return {
    days: program.days.map((d, i) => ({
      day: i,
      name: DAY_NAMES[i],
      kind: d.kind,
      label: d.label,
      exercises: d.entries.map((e) => `${nameOf(e.exerciseId)}: ${e.sets} x ${e.reps ?? defaultReps(e.exerciseId)}`),
    })),
    weeklySets: groups
      .map((g) => ({ group: g.id, sets: Math.round(week.weekly[g.id] * 10) / 10, band: bandFor(g.id, week.weekly[g.id])?.band ?? null }))
      .filter((g) => g.sets > 0 || g.band !== null),
  }
}

export function createProgram(input: ProgramInput, origin: string) {
  const program = buildProgram(input)
  const url = `${origin.replace(/\/$/, '')}/shared#${encodeProgram(program)}`
  return { url, ...summarize(program) }
}

export function readProgram(link: string): ProgramInput & { summary: ReturnType<typeof summarize> } {
  const fragment = link.includes('#') ? link.slice(link.indexOf('#') + 1) : link
  const result = decodeProgram(fragment, { replacedBy })
  if (!result.ok) throw new ToolError([`could not read the link (${result.error})`])
  const p = result.program
  const days: DayInput[] = []
  p.days.forEach((d, day) => {
    if (d.kind !== 'train') return
    days.push({
      day,
      ...(d.label ? { label: d.label } : {}),
      ...(d.note ? { note: d.note } : {}),
      entries: d.entries.map((e) => ({ exerciseId: e.exerciseId, sets: e.sets, ...(e.reps ? { reps: e.reps } : {}) })),
    })
  })
  return { name: p.name, days, custom: p.custom, summary: summarize(p) }
}

import { normalizeProgramSupersets } from './program.ts'
import { Program } from './schema.ts'

const customIssues = (program: Program) => {
  const ids = new Set(program.custom.map((c) => c.id))
  const dangling = program.days.some((d) => d.entries.some((e) => typeof e.exerciseId === 'string' && !ids.has(e.exerciseId)))
  return { ids, duplicate: ids.size !== program.custom.length, dangling }
}

/**
 * Schema check plus what the schema cannot express: custom exercise ids are unique and every
 * custom reference in the week points at one of them. Share links and program imports use it.
 */
export function validateProgram(raw: unknown): Program | null {
  const parsed = Program.safeParse(raw)
  if (!parsed.success) return null
  const { duplicate, dangling } = customIssues(parsed.data)
  return duplicate || dangling ? null : parsed.data
}

/**
 * For what the app wrote itself (storage, backups): a custom id that repeats keeps its first
 * exercise, and entries pointing at a custom exercise that is gone are dropped. Older versions
 * could save such references, so the program is kept rather than refused.
 */
export function repairProgram(raw: unknown): Program | null {
  const parsed = Program.safeParse(raw)
  if (!parsed.success) return null
  const program = parsed.data
  const { ids, duplicate, dangling } = customIssues(program)
  if (!duplicate && !dangling) return program
  const custom = program.custom.filter((c, i) => program.custom.findIndex((o) => o.id === c.id) === i)
  const days = program.days.map((d) => ({ ...d, entries: d.entries.filter((e) => typeof e.exerciseId !== 'string' || ids.has(e.exerciseId)) }))
  return normalizeProgramSupersets({ ...program, custom, days })
}

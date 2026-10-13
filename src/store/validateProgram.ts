import { Program } from '../domain/schema.ts'

/**
 * Schema check plus what the schema cannot express: custom exercise ids are unique and every
 * custom reference in the week points at one of them. Shared by every import path.
 */
export function validateProgram(raw: unknown): Program | null {
  const parsed = Program.safeParse(raw)
  if (!parsed.success) return null
  const program = parsed.data
  const ids = new Set(program.custom.map((c) => c.id))
  if (ids.size !== program.custom.length) return null
  for (const day of program.days) {
    for (const e of day.entries) if (typeof e.exerciseId === 'string' && !ids.has(e.exerciseId)) return null
  }
  return program
}

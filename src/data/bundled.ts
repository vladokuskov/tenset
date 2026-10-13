import type { z } from 'zod'
import { parseRecords } from './parse.ts'

// Dev and tests validate the bundled data; production trusts it, since the data tests gate every file in CI.
const validate = !import.meta.env.PROD

/** Glob-imported records, skipping invalid ones in dev (reported through `warn`). */
export function bundledRecords<T>(modules: Record<string, unknown>, schema: z.ZodType<T>, warn?: (message: string) => void): T[] {
  return validate ? parseRecords(modules, schema, warn) : (Object.values(modules) as T[])
}

export function bundled<T>(schema: z.ZodType<T>, raw: unknown): T {
  return validate ? schema.parse(raw) : (raw as T)
}

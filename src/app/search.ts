import { z } from 'zod'
import { isGroup } from '../domain/taxonomy'

// Search param building blocks. Every param is optional and falls back to undefined when
// invalid, so a bad or stale URL never throws; screens apply their own defaults.

export const optionalEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).optional().catch(undefined)

export const sheetParam = <const T extends readonly [string, ...string[]]>(sheets: T) => optionalEnum(sheets)

export const groupParam = z
  .string()
  .refine((g) => isGroup(g))
  .optional()
  .catch(undefined)

export const textParam = z.string().max(80).optional().catch(undefined)

import { z } from 'zod'
import { Pattern } from '../domain/schema'
import { isGroup, visibleHeads } from '../domain/taxonomy'
import { DAY_SLUGS } from './days'

// Search param building blocks. Every param is optional and falls back to undefined when
// invalid, so a bad or stale URL never throws; screens apply their own defaults.

export const optionalEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).optional().catch(undefined)

export const sheetParam = <const T extends readonly [string, ...string[]]>(sheets: T) => optionalEnum(sheets)

export const daySlugParam = optionalEnum(DAY_SLUGS)

export const groupParam = z
  .string()
  .refine((g) => isGroup(g))
  .optional()
  .catch(undefined)

const headIds = new Set(visibleHeads.map((h) => h.id))
export const headParam = z
  .string()
  .refine((h) => headIds.has(h))
  .optional()
  .catch(undefined)

export const patternParam = Pattern.optional().catch(undefined)

export const textParam = z.string().max(80).optional().catch(undefined)

export const idParam = z
  .string()
  .regex(/^[a-z0-9]{1,24}$/)
  .optional()
  .catch(undefined)

export const stepParam = (max: number) => z.number().int().min(1).max(max).optional().catch(undefined)

import { z } from 'zod'
import { SHARE_LINK_MAX } from '../../src/domain/codec.ts'
import { CustomExercise, ExerciseRef } from '../../src/domain/schema.ts'

// Caps sized to what the app can use, so one request stays cheap.
export const ENTRIES_MAX = 40
export const QUERY_MAX = 200
export const ID_MAX = 40
export const EQUIPMENT_MAX = 64
/** A share link: the longest fragment the app opens plus room for the origin. */
export const LINK_MAX = SHARE_LINK_MAX + 2048

export const EntryInput = z.object({
  exerciseId: ExerciseRef.describe('Catalog id from search_exercises, or a custom id like "c1"'),
  sets: z.number().int().min(1).max(20),
  reps: z.string().max(16).optional().describe('Rep range like "8-12"; omit to use the exercise default'),
  restSec: z
    .number()
    .int('restSec must be whole seconds')
    .min(0, 'restSec must be 0 to 600')
    .max(600, 'restSec must be 0 to 600')
    .optional()
    .describe('Rest between sets in seconds, 0 to 600; rounded to the nearest 15'),
  rir: z
    .number()
    .int('rir must be a whole number')
    .min(0, 'rir must be 0 to 5')
    .max(5, 'rir must be 0 to 5')
    .optional()
    .describe('Target reps in reserve, 0 to 5'),
  supersetWithPrevious: z
    .boolean()
    .optional()
    .describe('Pair with the entry above as a superset. Pairs only: ignored on the first entry of a day or after an entry that is already paired'),
})

export const DayInput = z.object({
  day: z.number().int().min(0).max(6).describe('0 = Monday ... 6 = Sunday'),
  label: z.string().max(24).optional().describe('Short session name, e.g. "Upper A"'),
  note: z.string().max(80).optional(),
  entries: z.array(EntryInput).max(ENTRIES_MAX, `at most ${ENTRIES_MAX} exercises per day`),
})

export const ProgramInput = {
  name: z.string().min(1).max(40),
  days: z.array(DayInput).max(7).describe('Training days only; days left out are rest days'),
  custom: z.array(CustomExercise).max(30).optional().describe('Exercises missing from the catalog. ids "c1".."c63"'),
}

export const SearchInput = {
  query: z
    .string()
    .max(QUERY_MAX, `query is over ${QUERY_MAX} characters`)
    .optional()
    .describe('Words matched against names, aliases, muscles, equipment and movement, e.g. "incline press". A muscle word like "chest" lists primary movers first'),
  group: z.string().max(ID_MAX).optional().describe('Muscle group id; primary movers sort first'),
  pattern: z.string().max(ID_MAX).optional().describe('Movement pattern id'),
  equipment: z
    .array(z.string().max(ID_MAX))
    .max(EQUIPMENT_MAX)
    .optional()
    .describe('Equipment the user has; only exercises needing nothing else are returned. [] means bodyweight only'),
  limit: z.number().int().min(1).max(400).optional(),
}

export const ReadInput = {
  link: z
    .string()
    .max(LINK_MAX, `link is over ${LINK_MAX} characters, longer than any link the app makes`)
    .describe('Full share link or just the part after #'),
}

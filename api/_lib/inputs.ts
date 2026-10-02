import { z } from 'zod'
import { CustomExercise, ExerciseRef } from '../../src/domain/schema.ts'

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
  entries: z.array(EntryInput),
})

export const ProgramInput = {
  name: z.string().min(1).max(40),
  days: z.array(DayInput).max(7).describe('Training days only; days left out are rest days'),
  custom: z.array(CustomExercise).max(30).optional().describe('Exercises missing from the catalog. ids "c1".."c63"'),
}

export const SearchInput = {
  query: z.string().optional().describe('Words matched against name and aliases, e.g. "incline press"'),
  group: z.string().optional().describe('Muscle group id; primary movers sort first'),
  pattern: z.string().optional().describe('Movement pattern id'),
  equipment: z
    .array(z.string())
    .optional()
    .describe('Equipment the user has; only exercises needing nothing else are returned. [] means bodyweight only'),
  limit: z.number().int().min(1).max(200).optional(),
}

export const ReadInput = { link: z.string().describe('Full share link or just the part after #') }

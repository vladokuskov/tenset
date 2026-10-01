import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { CustomExercise, ExerciseRef } from '../../src/domain/schema.ts'
import { ToolError, createProgram, getReference, listSplits, readProgram, searchExercises } from './tools.ts'

const INSTRUCTIONS = `gym-builder plans a weekly gym program and shows weekly sets per muscle group on a body map.
Workflow: call get_reference once for muscle group, equipment and pattern ids. Use list_splits for ready-made templates and search_exercises to find exercise ids (filter by the user's equipment). Then call create_program and give the user the returned url. Opening it shows a preview with a Save button. The app keeps programs only in the user's browser, so the link is the only way in.
To change a program the user already has, ask them to share its link from the app and pass it to read_program; it returns the same shape create_program takes.
Check weeklySets in the result: "target" is the intended range for most groups. Keep wording neutral.`

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })

async function run(fn: () => unknown) {
  try {
    return json(fn())
  } catch (e) {
    if (e instanceof ToolError) return { isError: true, content: [{ type: 'text' as const, text: `Fix these and try again:\n${e.problems.join('\n')}` }] }
    throw e
  }
}

const EntryInput = z.object({
  exerciseId: ExerciseRef.describe('Catalog id from search_exercises, or a custom id like "c1"'),
  sets: z.number().int().min(1).max(20),
  reps: z.string().max(16).optional().describe('Rep range like "8-12"; omit to use the exercise default'),
})

const DayInput = z.object({
  day: z.number().int().min(0).max(6).describe('0 = Monday ... 6 = Sunday'),
  label: z.string().max(24).optional().describe('Short session name, e.g. "Upper A"'),
  note: z.string().max(80).optional(),
  entries: z.array(EntryInput),
})

const ProgramInput = {
  name: z.string().min(1).max(40),
  days: z.array(DayInput).max(7).describe('Training days only; days left out are rest days'),
  custom: z.array(CustomExercise).max(30).optional().describe('Exercises missing from the catalog. ids "c1".."c63"'),
}

export function createServer(origin: string): McpServer {
  const server = new McpServer({ name: 'gym-builder', version: '1.0.0' }, { instructions: INSTRUCTIONS })
  const readOnly = { readOnlyHint: true, openWorldHint: false }

  server.registerTool(
    'get_reference',
    {
      description: 'Ids for muscle groups, equipment, movement patterns and days, plus input limits.',
      annotations: readOnly,
    },
    () => run(getReference),
  )

  server.registerTool(
    'search_exercises',
    {
      description:
        'Find catalog exercises. All filters are optional and combine with AND. With no filters it returns the whole catalog.',
      inputSchema: {
        query: z.string().optional().describe('Words matched against name and aliases, e.g. "incline press"'),
        group: z.string().optional().describe('Muscle group id; primary movers sort first'),
        pattern: z.string().optional().describe('Movement pattern id'),
        equipment: z
          .array(z.string())
          .optional()
          .describe('Equipment the user has; only exercises needing nothing else are returned. [] means bodyweight only'),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: readOnly,
    },
    (args) => run(() => searchExercises(args)),
  )

  server.registerTool(
    'list_splits',
    {
      description: 'Built-in split templates. Each slot lists ranked exercise options; pick the first one the user can do.',
      annotations: readOnly,
    },
    () => run(listSplits),
  )

  server.registerTool(
    'create_program',
    {
      description:
        'Validate a weekly program and return a link that opens it in the app, plus weekly sets per muscle group. Nothing is stored.',
      inputSchema: ProgramInput,
      annotations: readOnly,
    },
    (args) => run(() => createProgram(args, origin)),
  )

  server.registerTool(
    'read_program',
    {
      description: 'Read a gym-builder share link into the shape create_program accepts, so it can be edited.',
      inputSchema: { link: z.string().describe('Full share link or just the part after #') },
      annotations: readOnly,
    },
    ({ link }) => run(() => readProgram(link)),
  )

  return server
}

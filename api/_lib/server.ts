import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ProgramInput, ReadInput, SearchInput } from './inputs.ts'
import { ToolError, createProgram, getReference, listSplits, readProgram, searchExercises } from './tools.ts'

const INSTRUCTIONS = `Tenset plans a weekly gym program and shows weekly sets per muscle group on a body map.
Workflow: call get_reference once for muscle group, equipment and pattern ids. Use list_splits for ready-made templates and search_exercises to find exercise ids (filter by the user's equipment). Then call create_program and give the user the returned url. Opening it shows a preview with a Save button. The app keeps programs only in the user's browser, so the link is the only way in.
To change a program the user already has, ask them to share its link from the app and pass it to read_program; it returns the same shape create_program takes.
Entries take optional restSec (rest between sets, 0 to 600, rounded to 15), rir (target reps in reserve, 0 to 5) and supersetWithPrevious (pairs the entry with the one above; pairs only, anything else is ignored and listed in "notes").
Check weeklySets in the result: band "target" means the sets fall in the intended range for most groups, and "target" holds that range as [low, high] weekly sets. Keep wording neutral.`

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })

async function run(fn: () => unknown) {
  try {
    return json(fn())
  } catch (e) {
    if (e instanceof ToolError) return { isError: true, content: [{ type: 'text' as const, text: `Fix these and try again:\n${e.problems.join('\n')}` }] }
    throw e
  }
}

export function createServer(origin: string): McpServer {
  const server = new McpServer({ name: 'tenset', version: '1.0.0' }, { instructions: INSTRUCTIONS })
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
      inputSchema: SearchInput,
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
      description: 'Read a Tenset share link into the shape create_program accepts, so it can be edited.',
      inputSchema: ReadInput,
      annotations: readOnly,
    },
    ({ link }) => run(() => readProgram(link)),
  )

  return server
}

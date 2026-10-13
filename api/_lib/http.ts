import { z } from 'zod'
import { BodyTooLarge, readBody } from './body.ts'
import { ProgramInput, ReadInput, SearchInput } from './inputs.ts'
import { ToolError, createProgram, getReference, listSplits, readProgram, searchExercises } from './tools.ts'

// Plain HTTP mirror of the MCP tools for agents that can fetch URLs but have no MCP client.

const QUERY_MAX = 8000

const ROUTES = [
  'GET /api/agent/reference',
  'GET /api/agent/splits',
  'GET /api/agent/exercises?query=&group=&pattern=&equipment=barbell,dumbbell&limit=',
  'GET /api/agent/program?program=<url-encoded JSON>',
  'POST /api/agent/program (JSON body)',
  'GET /api/agent/read?link=<share link, url-encoded>',
  'POST /api/agent/read ({"link": "..."})',
]

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' }

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS } })

class BadInput extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(problems.join('\n'))
    this.problems = problems
  }
}

function parse<T extends z.ZodRawShape>(shape: T, value: unknown): z.infer<z.ZodObject<T>> {
  const result = z.object(shape).safeParse(value)
  if (!result.success) throw new BadInput(result.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`))
  return result.data
}

function jsonParam(params: URLSearchParams, name: string): unknown {
  const raw = params.get(name)
  if (raw === null) throw new BadInput([`missing ?${name}=, or POST the JSON body instead`])
  if (raw.length > QUERY_MAX) throw new BadInput([`?${name}= is over ${QUERY_MAX} characters, POST the JSON body instead`])
  try {
    return JSON.parse(raw)
  } catch {
    throw new BadInput([`?${name}= is not valid JSON`])
  }
}

async function body(request: Request): Promise<unknown> {
  const text = await readBody(request)
  try {
    return JSON.parse(text)
  } catch {
    throw new BadInput(['body is not valid JSON'])
  }
}

function searchParams(params: URLSearchParams) {
  const equipment = params.get('equipment')
  const limit = params.get('limit')
  return {
    ...(params.get('query') ? { query: params.get('query') } : {}),
    ...(params.get('group') ? { group: params.get('group') } : {}),
    ...(params.get('pattern') ? { pattern: params.get('pattern') } : {}),
    ...(equipment !== null ? { equipment: equipment.split(',').map((e) => e.trim()).filter(Boolean) } : {}),
    ...(limit ? { limit: Number(limit) } : {}),
  }
}

type Handler = { GET?: (url: URL) => unknown; POST?: (request: Request, url: URL) => Promise<unknown> }

const handlers: Record<string, Handler> = {
  reference: { GET: getReference },
  splits: { GET: listSplits },
  exercises: { GET: (url) => searchExercises(parse(SearchInput, searchParams(url.searchParams))) },
  program: {
    GET: (url) => createProgram(parse(ProgramInput, jsonParam(url.searchParams, 'program')), url.origin),
    POST: async (request, url) => createProgram(parse(ProgramInput, await body(request)), url.origin),
  },
  read: {
    GET: (url) => readProgram(parse(ReadInput, { link: url.searchParams.get('link') ?? undefined }).link),
    POST: async (request) => readProgram(parse(ReadInput, await body(request)).link),
  },
}

export async function handleAgentRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const name = url.pathname.replace(/\/+$/, '').split('/').pop() ?? ''
  const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined
  if (!handler) return reply(404, { error: `unknown route "${name}"`, routes: ROUTES, guide: `${url.origin}/llms.txt` })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  try {
    if (request.method === 'GET' && handler.GET) return reply(200, handler.GET(url))
    if (request.method === 'POST' && handler.POST) return reply(200, await handler.POST(request, url))
    return reply(405, { error: `${request.method} is not supported here`, routes: ROUTES })
  } catch (e) {
    if (e instanceof BadInput || e instanceof ToolError) return reply(400, { error: 'Fix these and try again', problems: e.problems })
    if (e instanceof BodyTooLarge) return reply(413, { error: e.message })
    throw e
  }
}

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createServer } from './_lib/server.ts'

// Stateless MCP endpoint: a fresh server per request, nothing stored.
export async function POST(request: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  const server = createServer(new URL(request.url).origin)
  await server.connect(transport)
  return transport.handleRequest(request)
}

const notAllowed = () =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }), {
    status: 405,
    headers: { 'content-type': 'application/json', allow: 'POST' },
  })

export const GET = notAllowed
export const DELETE = notAllowed

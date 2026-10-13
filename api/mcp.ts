import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { BodyTooLarge, readBody } from './_lib/body.ts'
import { createServer } from './_lib/server.ts'

const rpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

// Stateless MCP endpoint: a fresh server per request, nothing stored.
export async function POST(request: Request): Promise<Response> {
  let text: string
  try {
    text = await readBody(request)
  } catch (e) {
    if (e instanceof BodyTooLarge) return rpcError(413, e.message)
    throw e
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  const server = createServer(new URL(request.url).origin)
  await server.connect(transport)
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  return transport.handleRequest(new Request(request.url, { method: 'POST', headers, body: text }))
}

const notAllowed = () => rpcError(405, 'Method not allowed', { allow: 'POST' })

export const GET = notAllowed
export const DELETE = notAllowed

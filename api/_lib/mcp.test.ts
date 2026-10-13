import { expect, it } from 'vitest'
import { POST } from '../mcp.ts'
import { BODY_MAX } from './body.ts'

const URL_ = 'https://example.test/api/mcp'
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
const rpc = (body: unknown) => new Request(URL_, { method: 'POST', headers, body: JSON.stringify(body) })

it('answers a tool call', async () => {
  const res = await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_exercises', arguments: { query: 'pullup', limit: 1 } } }))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { result: { content: { text: string }[] } }
  expect(JSON.parse(body.result.content[0].text).count).toBeGreaterThan(5)
})

it('refuses an oversized body before parsing it', async () => {
  const query = 'a '.repeat(BODY_MAX)
  const res = await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_exercises', arguments: { query } } }))
  expect(res.status).toBe(413)
  expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/over \d+ bytes/)
})

it('refuses an oversized streamed body without a content length', async () => {
  const chunk = new TextEncoder().encode(' '.repeat(16 * 1024))
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent++ > 20) c.close()
      else c.enqueue(chunk)
    },
  })
  const res = await POST(new Request(URL_, { method: 'POST', headers, body, duplex: 'half' } as RequestInit))
  expect(res.status).toBe(413)
})

it('reports input caps as tool errors', async () => {
  const res = await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_exercises', arguments: { query: 'a'.repeat(201) } } }))
  const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } }
  expect(body.result.isError).toBe(true)
  expect(body.result.content[0].text).toMatch(/query is over 200 characters/)
})

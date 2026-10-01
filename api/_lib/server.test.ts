import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { expect, it } from 'vitest'
import { createServer } from './server.ts'

async function connect() {
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1' })
  await Promise.all([createServer('https://example.test').connect(a), client.connect(b)])
  return client
}

const text = (r: Awaited<ReturnType<Client['callTool']>>) => (r.content as { text: string }[])[0].text

it('exposes the tools and builds a link', async () => {
  const client = await connect()
  const { tools } = await client.listTools()
  expect(tools.map((t) => t.name).sort()).toEqual(['create_program', 'get_reference', 'list_splits', 'read_program', 'search_exercises'])

  const ok = await client.callTool({ name: 'create_program', arguments: { name: 'Push', days: [{ day: 0, entries: [{ exerciseId: 101, sets: 3 }] }] } })
  expect(ok.isError).toBeFalsy()
  expect(JSON.parse(text(ok)).url).toMatch(/^https:\/\/example\.test\/shared#/)

  const bad = await client.callTool({ name: 'create_program', arguments: { name: 'Push', days: [{ day: 0, entries: [{ exerciseId: 9999, sets: 3 }] }] } })
  expect(bad.isError).toBe(true)
  expect(text(bad)).toContain('exerciseId 9999 does not exist')
})

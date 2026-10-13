import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { handleAgentRequest } from './http.ts'

const llms = readFileSync(new URL('../../public/llms.txt', import.meta.url), 'utf8')

it('steers agents to POST so programs stay out of request addresses', () => {
  expect(llms).toMatch(/Send programs and links with POST/)
  expect(llms).not.toMatch(/https:\/\/\S+\/api\/agent\/program\?program=/)
  expect(llms).toMatch(/curl -X POST \S+\/api\/agent\/program/)
})

it('has a POST example that builds a program', async () => {
  const body = llms.match(/-d '(\{.*\})'/)![1]
  const res = await handleAgentRequest(
    new Request('https://example.test/api/agent/program', { method: 'POST', headers: { 'content-type': 'application/json' }, body }),
  )
  expect(res.status).toBe(200)
})

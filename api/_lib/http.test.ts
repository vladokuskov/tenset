import { expect, it } from 'vitest'
import { handleAgentRequest } from './http.ts'

const BASE = 'https://example.test/api/agent'
const PROGRAM = { name: 'Push', days: [{ day: 0, label: 'A', entries: [{ exerciseId: 101, sets: 3, reps: '8-12' }] }] }

type Body = {
  url: string
  name: string
  days: unknown
  problems: string[]
  routes: string[]
  equipment: unknown[]
  exercises: { id: number; equipment: unknown[] }[]
  length: number
  limits: object
}

async function call(path: string, init?: RequestInit) {
  const res = await handleAgentRequest(new Request(`${BASE}/${path}`, init))
  return { status: res.status, body: (await res.json()) as Body, headers: res.headers }
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

it('serves reference data and splits', async () => {
  const ref = await call('reference')
  expect(ref.status).toBe(200)
  expect(ref.headers.get('access-control-allow-origin')).toBe('*')
  expect(ref.body.equipment.length).toBeGreaterThan(0)
  const splits = await call('splits')
  expect(splits.status).toBe(200)
  expect(splits.body.length).toBeGreaterThan(0)
})

it('filters exercises by query params', async () => {
  const { status, body } = await call('exercises?query=bench%20press&limit=2')
  expect(status).toBe(200)
  expect(body.exercises.length).toBeLessThanOrEqual(2)
  expect(body.exercises[0].id).toBe(101)

  const bodyweight = await call('exercises?equipment=')
  expect(bodyweight.body.exercises.every((e) => e.equipment.length === 0)).toBe(true)
})

it('builds a link from GET or POST and reads it back', async () => {
  const viaGet = await call(`program?program=${encodeURIComponent(JSON.stringify(PROGRAM))}`)
  expect(viaGet.status).toBe(200)
  expect(viaGet.body.url).toMatch(/^https:\/\/example\.test\/shared#/)

  const viaPost = await call('program', post(PROGRAM))
  expect(viaPost.body.url).toBe(viaGet.body.url)

  const read = await call(`read?link=${encodeURIComponent(viaGet.body.url)}`)
  expect(read.status).toBe(200)
  expect(read.body.name).toBe('Push')
  expect(read.body.days).toEqual(PROGRAM.days)
})

it('explains bad input', async () => {
  const bad = await call('program', post({ name: 'Push', days: [{ day: 0, entries: [{ exerciseId: 9999, sets: 3 }] }] }))
  expect(bad.status).toBe(400)
  expect(bad.body.problems.join('\n')).toContain('exerciseId 9999 does not exist')

  expect((await call('program')).body.problems[0]).toContain('missing ?program=')
  expect((await call('program?program=%7Bnope')).body.problems[0]).toContain('not valid JSON')
  expect((await call(`program?program=${'x'.repeat(9000)}`)).body.problems[0]).toContain('POST')
  expect((await call('program', post({ name: '', days: [] }))).body.problems[0]).toMatch(/^name:/)

  const entries = [{ exerciseId: 101, sets: 3, rir: 6, restSec: 700 }, { exerciseId: 301, sets: 3, rir: 1.5 }]
  expect((await call('program', post({ name: 'Push', days: [{ day: 0, entries }] }))).body.problems).toEqual([
    'days.0.entries.0.restSec: restSec must be 0 to 600',
    'days.0.entries.0.rir: rir must be 0 to 5',
    'days.0.entries.1.rir: rir must be a whole number',
  ])
})

it('rejects unknown routes and methods', async () => {
  const missing = await call('constructor')
  expect(missing.status).toBe(404)
  expect(missing.body.routes.length).toBeGreaterThan(0)
  expect((await call('reference', post({}))).status).toBe(405)
  expect((await handleAgentRequest(new Request(`${BASE}/program`, { method: 'OPTIONS' }))).status).toBe(204)
})

it('caps input sizes with clear errors', async () => {
  const entries = Array.from({ length: 41 }, () => ({ exerciseId: 101, sets: 3 }))
  const many = await call('program', post({ name: 'Big', days: [{ day: 0, entries }] }))
  expect(many.status).toBe(400)
  expect(many.body.problems.join()).toMatch(/at most 40 exercises per day/)

  const query = await call(`exercises?query=${'a%20'.repeat(201)}`)
  expect(query.status).toBe(400)
  expect(query.body.problems.join()).toMatch(/query is over 200 characters/)

  const link = await call('read', post({ link: `https://example.test/shared#${'A'.repeat(20000)}` }))
  expect(link.status).toBe(400)
  expect(link.body.problems.join()).toMatch(/link is over/)
})

it('refuses an oversized body', async () => {
  const res = await call('program', post({ name: 'Big', days: [], pad: 'x'.repeat(200 * 1024) }))
  expect(res.status).toBe(413)
})

it('lists the entry and query caps in the reference', async () => {
  const ref = await call('reference')
  expect(ref.body.limits).toMatchObject({ entriesPerDayMax: 40, queryMax: 200 })
})

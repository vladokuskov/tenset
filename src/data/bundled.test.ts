import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const Row = z.object({ id: z.number() })
const modules = { 'a.json': { id: 1 }, 'b.json': { id: 'bad' } }

async function load(prod: boolean) {
  vi.resetModules()
  vi.stubEnv('PROD', prod)
  return import('./bundled.ts')
}

afterEach(() => vi.unstubAllEnvs())

describe('bundled data', () => {
  it('validates in dev and tests', async () => {
    const { bundledRecords, bundled } = await load(false)
    const warn = vi.fn()
    expect(bundledRecords(modules, Row, warn)).toEqual([{ id: 1 }])
    expect(warn).toHaveBeenCalledOnce()
    expect(() => bundled(Row, { id: 'bad' })).toThrow()
  })

  it('skips the parse in production builds', async () => {
    const { bundledRecords, bundled } = await load(true)
    const spy = vi.spyOn(Row, 'safeParse')
    expect(bundledRecords(modules, Row)).toEqual([{ id: 1 }, { id: 'bad' }])
    expect(bundled(Row, { id: 'bad' })).toEqual({ id: 'bad' })
    expect(spy).not.toHaveBeenCalled()
  })
})

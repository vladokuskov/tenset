import { describe, expect, it } from 'vitest'
import { normalizeAll } from './normalize-params.ts'

describe('legacy media.params normalization', () => {
  it('maps every exercise record onto a frozen template schema', () => {
    const { rows, errors } = normalizeAll()
    expect(rows.length).toBeGreaterThanOrEqual(100)
    expect(errors).toEqual([])
  })
})

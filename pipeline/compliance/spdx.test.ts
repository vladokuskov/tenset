import { describe, expect, it } from 'vitest'
import { normalizeLicense, spdxAllowed } from './spdx.ts'

const ALLOWED = new Set(['MIT', 'Apache-2.0', 'BSD-3-Clause'])

describe('spdx', () => {
  it('checks single ids', () => {
    expect(spdxAllowed('MIT', ALLOWED)).toBe(true)
    expect(spdxAllowed('GPL-3.0', ALLOWED)).toBe(false)
  })

  it('needs one allowed branch for OR and all for AND', () => {
    expect(spdxAllowed('(GPL-2.0 OR MIT)', ALLOWED)).toBe(true)
    expect(spdxAllowed('MIT AND GPL-2.0', ALLOWED)).toBe(false)
    expect(spdxAllowed('(MIT AND BSD-3-Clause) OR GPL-3.0', ALLOWED)).toBe(true)
    expect(spdxAllowed('Apache-2.0 WITH LLVM-exception', ALLOWED)).toBe(true)
  })

  it('rejects malformed expressions', () => {
    expect(() => spdxAllowed('(MIT OR', ALLOWED)).toThrow()
    expect(() => spdxAllowed('MIT Apache-2.0', ALLOWED)).toThrow()
  })

  it('normalizes legacy package.json license fields', () => {
    expect(normalizeLicense({ type: 'MIT' })).toBe('MIT')
    expect(normalizeLicense([{ type: 'MIT' }, { type: 'Apache 2.0' }])).toBe('MIT OR Apache-2.0')
    expect(normalizeLicense(undefined)).toBe('UNKNOWN')
  })
})

import { describe, expect, it } from 'vitest'
import { bake, compactSize, decode, encode, frameQ, sampler, STEP } from './bake.ts'
import { getTemplate, parseParams } from './templates/index.ts'
import { testSkeleton } from './testing.ts'

const skel = testSkeleton()
const S1: [string, Record<string, unknown>][] = [
  ['squat', { hold: 'back_high' }],
  ['lateral-raise', {}],
  ['vertical-pull', { grip: 'pronated' }],
  ['curl', { supinate: true }],
]

describe('bake', () => {
  it.each(S1)('%s fits the 12 KB shipping budget and round-trips within the quantization step', (id, raw) => {
    const b = bake(getTemplate(id), parseParams(id, raw), skel)
    const c = encode(b, skel)
    expect(compactSize(c)).toBeLessThanOrEqual(12 * 1024)
    const d = decode(JSON.parse(JSON.stringify(c)), skel)
    expect(d.frames).toBe(b.frames)
    let worst = 0
    for (let i = 0; i < b.q.length; i++) {
      const unit = skel.dofs[i % b.nDof].unit
      worst = Math.max(worst, Math.abs(d.q[i] - b.q[i]) / STEP[unit])
    }
    expect(worst).toBeLessThanOrEqual(0.51)
    for (let i = 0; i < b.ip.length; i++) expect(Math.abs(d.ip[i] - b.ip[i])).toBeLessThan(STEP.m)
  })

  it('pose(t) passes through the baked frames and wraps seamlessly', () => {
    const b = bake(getTemplate('curl'), parseParams('curl', {}), skel)
    const pose = sampler(b)
    const dt = b.duration / b.frames
    for (const i of [0, 17, 50, b.frames - 1]) {
      const q = frameQ(b, i)
      const p = pose(i * dt).q
      for (let k = 0; k < q.length; k++) expect(p[k]).toBeCloseTo(q[k], 4)
    }
    const a = pose(b.duration - 1e-6).q, z = pose(0).q, w = pose(b.duration * 3 + 1e-6).q
    for (let k = 0; k < a.length; k++) {
      expect(Math.abs(a[k] - z[k])).toBeLessThan(1e-3)
      expect(w[k]).toBeCloseTo(z[k], 3)
    }
  })
})

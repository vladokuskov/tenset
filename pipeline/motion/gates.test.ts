import { describe, expect, it } from 'vitest'
import { bake, compactSize, decode, encode, type Baked } from '../../src/motion/bake.ts'
import { getTemplate, parseParams } from '../../src/motion/templates/index.ts'
import { runGates } from './gates.ts'
import { loadSkeleton } from './load.ts'

const skel = loadSkeleton()

function shipped(id: string, raw: Record<string, unknown>) {
  const b = bake(getTemplate(id), parseParams(id, raw), skel)
  const c = encode(b, skel)
  return { b: decode(c, skel), bytes: compactSize(c) }
}

const clone = (b: Baked): Baked => ({ ...b, q: b.q.slice(), ip: b.ip.slice() })
const failed = (b: Baked) => runGates(b, skel).filter((g) => !g.pass)

describe('motion QA gates', () => {
  const squat = shipped('squat', { hold: 'back_high' })

  it('pass on a clean baked squat and pull-up', () => {
    expect(runGates(squat.b, skel, squat.bytes).filter((g) => !g.pass)).toEqual([])
    const pull = shipped('vertical-pull', {})
    expect(runGates(pull.b, skel, pull.bytes).filter((g) => !g.pass)).toEqual([])
  })

  it('catch an injected one-frame IK flip', () => {
    const b = clone(squat.b)
    const frame = 30
    b.q[frame * b.nDof + skel.dof['elbow_l.flex']] -= 25
    b.q[frame * b.nDof + skel.dof['shoulder_l.rot']] += 25
    const bad = failed(b)
    const flip = bad.filter((g) => /flip/.test(g.name))
    expect(flip.length).toBeGreaterThan(0)
    for (const g of flip) expect(Math.abs(g.frame! - frame)).toBeLessThanOrEqual(2)
  })

  it('catch an injected 10 mm foot slide', () => {
    const b = clone(squat.b)
    // both feet drift 10 mm sideways over a few frames and stay there for part of the rep
    for (let i = 40; i < 70; i++) b.q[i * b.nDof + skel.dof['pelvis.tx']] += 0.01 * Math.min(1, (i - 40) / 4)
    const bad = failed(b)
    const slip = bad.find((g) => g.name === 'foot slip')
    expect(slip).toBeDefined()
    expect(slip!.value).toBeGreaterThan(9)
    expect(slip!.value).toBeLessThan(11)
    expect(bad.some((g) => g.name === 'foot target error')).toBe(true)
  })

  it('catch a loop that does not close', () => {
    const b = clone(squat.b)
    // head pitch drifts 6 deg over the loop, so the last frame no longer meets the first
    for (let i = 0; i < b.frames; i++) b.q[i * b.nDof + skel.dof['head.flex']] += (6 * i) / b.frames
    expect(failed(b).map((g) => g.name)).toContain('loop seam position')
  })

  it('catch knee hyperextension', () => {
    const b = clone(squat.b)
    for (let i = 0; i < b.frames; i++) b.q[i * b.nDof + skel.dof['knee_r.flex']] -= 6
    expect(failed(b).map((g) => g.name)).toContain('knee/elbow hyperextension')
  })
})

import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import { loopDuration } from '../timing.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('leg-curl')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('leg-curl'), parseParams('leg-curl', v.params, v.laterality), skel)]))
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const bottomU = (b: Baked) => (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] / 2) / loopDuration(b.tempo)
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]

describe('leg-curl template', () => {
  it('covers the seated, lying and Nordic curls', () => {
    expect(variants.map((v) => v.id).sort()).toEqual([503, 504, 512])
  })

  it.each([503, 504])('%s: knee ~5 -> 110-130 (research), hips held, hands on the handles', (id) => {
    const b = baked.get(id)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    // top of the loop is the curl (the concentric end), the bottom the stretch
    expect(dof(b, 0, 'knee_l.flex')).toBeGreaterThan(110)
    expect(dof(b, 0, 'knee_l.flex')).toBeLessThan(130)
    expect(dof(b, bottomU(b), 'knee_l.flex')).toBeLessThan(10)
    const pelvis0 = segPos(skel, fk(skel, frameQ(b, 0)), 'pelvis')
    const hip0 = dof(b, 0, 'hip_l.flex')
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      const f = fk(skel, q)
      // no hip lift off the pad or the seat
      expect(dist(segPos(skel, f, 'pelvis'), pelvis0)).toBeLessThan(0.001)
      expect(q[skel.dof['hip_l.flex']]).toBeCloseTo(hip0, 5)
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if (!('implement' in c.target)) continue
        const j = b.implements.findIndex((s) => s.id === (c.target as { implement: string }).implement)
        expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[j], impl[j], c.target.grip).pos)).toBeLessThan(0.005)
      }
    }
  })

  it('seated at the record hip angle, lying prone with the hips straight', () => {
    expect(dof(baked.get(503)!, 0, 'hip_l.flex')).toBeCloseTo(90, 5)
    expect(Math.abs(dof(baked.get(504)!, 0, 'hip_l.flex'))).toBeLessThan(1)
  })

  it('Nordic: kneeling upright -> lowered to the catch, body straight from knees to head, ankles anchored', () => {
    const b = baked.get(512)!
    expect(dof(b, 0, 'knee_l.flex')).toBeCloseTo(90, 0)
    expect(dof(b, bottomU(b), 'knee_l.flex')).toBeLessThan(30)
    const ankle0 = segPos(skel, fk(skel, frameQ(b, 0)), 'foot_l')
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      // hips stay open (no piking) while the knees lower the straight body
      expect(Math.abs(q[skel.dof['hip_l.flex']])).toBeLessThan(5)
      expect(dist(segPos(skel, fk(skel, q), 'foot_l'), ankle0)).toBeLessThan(0.01)
    }
    // at the catch the palms are on the mat
    const k = b.implements.findIndex((s) => s.id === 'catch')
    const top = siteWorld(b.implements[k], frameImplements(b, at(b, bottomU(b)))[k], 'top').pos[1]
    const f = fk(skel, frameQ(b, at(b, bottomU(b))))
    for (const s of ['l', 'r']) expect(Math.abs(sitePos(skel, f, `grip_${s}`)[1] - top)).toBeLessThan(0.05)
  })

  it.each([
    ['standing', { posture: 'standing', implement: 'cable' }],
    ['unilateral', { laterality: 'unilateral' }],
  ])('%s: throws variant not implemented yet', (_, params) => {
    expect(() => getTemplate('leg-curl').setup(parseParams('leg-curl', params), skel)).toThrow(/variant not implemented yet/)
  })
})

import { describe, expect, it } from 'vitest'
import { bake, frameQ, type Baked } from '../../bake.ts'
import { bodyCapsules } from '../../collide.ts'
import { fk, sitePos } from '../../fk.ts'
import { motionRecords, testSkeleton } from '../../testing.ts'
import { getTemplate, parseParams } from '../index.ts'
import { WALK } from './walk.ts'

const skel = testSkeleton()
const rec = motionRecords('hip-abduction').find((r) => r.id === 537)!
const b: Baked = bake(getTemplate('hip-abduction'), parseParams('hip-abduction', rec.params, rec.laterality), skel)
const soleY = (i: number, s: 'l' | 'r') => Math.min(...bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region === `foot_${s}`).map((c) => Math.min(c.a[1], c.b[1]) - c.r))
const footX = (i: number, s: 'l' | 'r') => sitePos(skel, fk(skel, frameQ(b, i)), `midfoot_${s}`)[0]

describe('hip-abduction band lateral walk', () => {
  it('is the standing band variant with the band round the knees', () => {
    expect(rec.params).toMatchObject({ implement: 'band', posture: 'standing' })
    expect(b.implements.some((s) => s.kind === 'band')).toBe(true)
  })

  it('four steps a loop: each foot lifts twice, never more than ~4 cm, and the loop ends where it began', () => {
    for (const s of ['l', 'r'] as const) {
      let lifts = 0, up = false
      for (let i = 0; i < b.frames; i++) {
        const y = soleY(i, s)
        expect(y).toBeGreaterThan(-0.005)
        expect(y).toBeLessThan(WALK.lift + 0.01)
        const now = y > 0.01
        if (now && !up) lifts++
        up = now
      }
      expect(lifts).toBe(2)
    }
    const a = frameQ(b, 0), z = frameQ(b, b.frames - 1)
    for (const d of skel.dofs) expect(Math.abs(a[d.index] - z[d.index]), d.name).toBeLessThan(d.unit === 'm' ? 0.01 : 1.5)
  })

  it('the stance widens by a step and narrows back; the feet only move sideways, toes forward', () => {
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < b.frames; i++) {
      const w = footX(i, 'l') - footX(i, 'r')
      lo = Math.min(lo, w)
      hi = Math.max(hi, w)
    }
    expect(lo).toBeCloseTo(WALK.width, 2)
    expect(hi).toBeCloseTo(WALK.width + WALK.step, 2)
    const z0 = sitePos(skel, fk(skel, frameQ(b, 0)), 'midfoot_l')[2]
    for (let i = 0; i < b.frames; i += 3) expect(Math.abs(sitePos(skel, fk(skel, frameQ(b, i)), 'midfoot_l')[2] - z0)).toBeLessThan(0.005)
  })

  it('a shallow squat held: knees bent ~15-45 deg, trunk lean steady', () => {
    for (let i = 0; i < b.frames; i += 2) {
      const q = frameQ(b, i)
      for (const s of ['l', 'r']) {
        expect(q[skel.dof[`knee_${s}.flex`]]).toBeGreaterThan(12)
        expect(q[skel.dof[`knee_${s}.flex`]]).toBeLessThan(45)
      }
      expect(q[skel.dof['pelvis.tilt']]).toBeCloseTo(WALK.tilt, 6)
    }
  })
})

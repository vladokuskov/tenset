import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import { loopDuration } from '../timing.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('leg-extension')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('leg-extension'), parseParams('leg-extension', v.params, v.laterality), skel)]))
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const bottomU = (b: Baked) => (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] / 2) / loopDuration(b.tempo)
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]

describe('leg-extension template', () => {
  it('covers the upright and the reclined leg extension', () => {
    expect(variants.map((v) => v.id).sort()).toEqual([404, 412])
  })

  it.each([...baked.keys()])('%s: knee ~90 -> near lockout (research: knee ~90 -> ~5), hips still at the record hip angle', (id) => {
    const b = baked.get(id)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    expect(dof(b, 0, 'knee_l.flex')).toBeLessThan(6)
    expect(dof(b, bottomU(b), 'knee_l.flex')).toBeGreaterThan(85)
    expect(dof(b, bottomU(b), 'knee_l.flex')).toBeLessThan(95)
    const hipAngle = b.params.hipAngle as number
    const pelvis0 = segPos(skel, fk(skel, frameQ(b, 0)), 'pelvis')
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      // no hip lift: the pelvis and the hip angle stay put through the whole rep
      expect(q[skel.dof['hip_l.flex']]).toBeCloseTo(hipAngle, 5)
      expect(dist(segPos(skel, fk(skel, q), 'pelvis'), pelvis0)).toBeLessThan(0.001)
      expect(q[skel.dof['knee_l.flex']]).toBeCloseTo(q[skel.dof['knee_r.flex']], 6)
    }
  })

  it('hands stay on the handles and the roller stays on the lower shins', () => {
    for (const [id, b] of baked) {
      const k = b.implements.findIndex((s) => s.id === 'lever')
      for (let i = 0; i < b.frames; i += 5) {
        const f = fk(skel, frameQ(b, i))
        const impl = frameImplements(b, i)
        for (const c of b.contacts) {
          if (!('implement' in c.target)) continue
          const j = b.implements.findIndex((s) => s.id === (c.target as { implement: string }).implement)
          expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[j], impl[j], c.target.grip).pos), `${id}`).toBeLessThan(0.005)
        }
        const [roller] = placeParts(b.implements[k], impl[k])
        const shins = bodyCapsules(skel, f).filter((c) => /^shank_/.test(c.region))
        const gap = Math.min(...shins.map((c) => capsuleSolidClearance(c, roller)))
        expect(gap, `${id} @${i}`).toBeGreaterThan(-0.015)
        expect(gap, `${id} @${i}`).toBeLessThan(0.005)
      }
    }
  })

  it('the reclined seat leans the trunk back (hip ~40 deg for the rectus femoris)', () => {
    const upright = baked.get(404)!, reclined = baked.get(412)!
    const lean = (b: Baked) => dof(b, 0, 'pelvis.tilt')
    expect(lean(upright)).toBeCloseTo(0, 0)
    expect(lean(reclined)).toBeLessThan(-40)
  })

  it('cable variant throws variant not implemented yet', () => {
    expect(() => getTemplate('leg-extension').setup(parseParams('leg-extension', { implement: 'cable' }), skel)).toThrow(/variant not implemented yet/)
  })
})

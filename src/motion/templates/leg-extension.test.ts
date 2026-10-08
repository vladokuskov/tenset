import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import { loopDuration } from '../timing.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'
import { KNEE } from './leg-extension.ts'

const skel = testSkeleton()
const variants = motionRecords('leg-extension')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('leg-extension'), parseParams('leg-extension', v.params, v.laterality), skel)]))
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const bottomU = (b: Baked) => (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] / 2) / loopDuration(b.tempo)
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]
/** the working knee (single leg: the record's side) */
const work = (b: Baked) => (b.params.laterality === 'unilateral' && b.params.side !== 'left' ? 'r' : 'l')

describe('leg-extension template', () => {
  it('covers the upright, the reclined and the single-leg extension', () => {
    expect(variants.map((v) => v.id).sort()).toEqual([404, 412, 435])
  })

  it.each([...baked.keys()])('%s: knee ~90 -> near lockout (research: knee ~90 -> ~5), hips still at the record hip angle', (id) => {
    const b = baked.get(id)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    const w = work(b)
    expect(dof(b, 0, `knee_${w}.flex`)).toBeLessThan(6)
    expect(dof(b, bottomU(b), `knee_${w}.flex`)).toBeGreaterThan(85)
    expect(dof(b, bottomU(b), `knee_${w}.flex`)).toBeLessThan(95)
    const hipAngle = b.params.hipAngle as number
    const pelvis0 = segPos(skel, fk(skel, frameQ(b, 0)), 'pelvis')
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      // no hip lift: the pelvis and the hip angle stay put through the whole rep
      expect(q[skel.dof['hip_l.flex']]).toBeCloseTo(hipAngle, 5)
      expect(dist(segPos(skel, fk(skel, q), 'pelvis'), pelvis0)).toBeLessThan(0.001)
      if (b.params.laterality === 'bilateral') expect(q[skel.dof['knee_l.flex']]).toBeCloseTo(q[skel.dof['knee_r.flex']], 6)
    }
  })

  it('single leg: the other knee stays at the start angle while the pad lifts away from its shin', () => {
    const b = baked.get(435)!
    expect(work(b)).toBe('r')
    const k = b.implements.findIndex((s) => s.id === 'lever')
    for (let i = 0; i < b.frames; i += 3) expect(frameQ(b, i)[skel.dof['knee_l.flex']]).toBeCloseTo(KNEE.start, 6)
    const idleGap = (i: number) => {
      const [roller] = placeParts(b.implements[k], frameImplements(b, i)[k])
      return Math.min(...bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region === 'shank_l').map((c) => capsuleSolidClearance(c, roller)))
    }
    // at the top the roller is well clear of the resting shin, at the stretch it is back on it
    expect(idleGap(0)).toBeGreaterThan(0.1)
    expect(idleGap(at(b, bottomU(b)))).toBeLessThan(0.005)
  })

  it('hands stay on the handles and the roller stays on the lower shins (single leg: the working shin)', () => {
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
        const shins = bodyCapsules(skel, f).filter((c) => (b.params.laterality === 'unilateral' ? c.region === `shank_${work(b)}` : /^shank_/.test(c.region)))
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

  it('cable and alternating variants throw variant not implemented yet', () => {
    expect(() => getTemplate('leg-extension').setup(parseParams('leg-extension', { implement: 'cable' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => getTemplate('leg-extension').setup(parseParams('leg-extension', {}, 'alternating'), skel)).toThrow(/variant not implemented yet/)
  })
})

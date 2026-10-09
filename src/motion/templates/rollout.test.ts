import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { AB_WHEEL } from '../implements/portable-c.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { contactError, frameAt, seamRatio } from './core/checks.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('rollout')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('rollout'), parseParams('rollout', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const dof = (b: Baked, i: number, name: string) => frameQ(b, i)[skel.dof[name]]
const TOP = 0, BOTTOM = 0.625
const wheel = (b: Baked, i: number) => frameImplements(b, i)[b.implements.findIndex((s) => s.kind === 'ab_wheel')]

describe('rollout template', () => {
  it('covers every family record', () => {
    expect([...baked.keys()].sort()).toEqual([810, 811, 812])
  })

  it.each([810, 811, 812])('%s: hands on the handles, the wheel on the floor, the loop closes', (id) => {
    const b = get(id)
    for (let i = 0; i < b.frames; i++) {
      expect(contactError(skel, b, i)).toBeLessThan(0.005)
      expect(wheel(b, i).pos[1]).toBeCloseTo(AB_WHEEL.R, 6)
      for (const s of ['l', 'r']) expect(dof(b, i, `elbow_${s}.flex`)).toBeLessThan(id === 812 ? 45 : 25)
    }
    expect(seamRatio(skel, b)).toBeLessThan(1.5)
  })

  it.each([810, 811])('%s: the wheel under the shoulders at the top rolls out to the reach, the hips open and the body lowers', (id) => {
    const b = get(id)
    const top = fk(skel, frameQ(b, frameAt(b, TOP))), bottom = fk(skel, frameQ(b, frameAt(b, BOTTOM)))
    expect(Math.abs(wheel(b, frameAt(b, TOP)).pos[2] - segPos(skel, top, 'humerus_l')[2])).toBeLessThan(0.35)
    expect(wheel(b, frameAt(b, BOTTOM)).pos[2] - wheel(b, frameAt(b, TOP)).pos[2]).toBeGreaterThan(0.5)
    expect(segPos(skel, bottom, 'humerus_l')[1]).toBeLessThan(segPos(skel, top, 'humerus_l')[1] - 0.2)
    // the hips open: the angle at the hip between the thigh and the trunk
    const fold = (f: ReturnType<typeof fk>) => {
      const hip = segPos(skel, f, 'femur_l'), knee = segPos(skel, f, 'tibia_l'), sh = segPos(skel, f, 'humerus_l')
      const a = [knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]], c = [sh[0] - hip[0], sh[1] - hip[1], sh[2] - hip[2]]
      return (Math.acos((a[0] * c[0] + a[1] * c[1] + a[2] * c[2]) / Math.hypot(...a) / Math.hypot(...c)) * 180) / Math.PI
    }
    expect(fold(bottom)).toBeGreaterThan(fold(top) + 30)
    expect(fold(bottom)).toBeGreaterThan(150)
    // the spine curls at the start and flattens out at full reach
    expect(dof(b, frameAt(b, TOP), 'lumbar.flex')).toBeGreaterThan(dof(b, frameAt(b, BOTTOM), 'lumbar.flex') + 8)
  })

  it('810 standing: legs straight, on the balls of the feet as the body lowers', () => {
    const b = get(810)
    const bottom = frameAt(b, BOTTOM)
    expect(dof(b, bottom, 'knee_l.flex')).toBeLessThan(10)
    expect(sitePos(skel, fk(skel, frameQ(b, bottom)), 'heel_l')[1]).toBeGreaterThan(0.08)
  })

  it('812 oblique: the wheel rolls out on a diagonal towards the working side and the trunk turns with it', () => {
    const b = get(812)
    const out = wheel(b, frameAt(b, BOTTOM)).pos
    // side right: towards -X
    expect(out[0]).toBeLessThan(-0.15)
    expect(dof(b, frameAt(b, BOTTOM), 'thorax.rot')).toBeLessThan(-10)
    expect(Math.abs(dof(b, frameAt(b, BOTTOM), 'pelvis.rot'))).toBeLessThan(1)
  })

  it('unsupported variants throw', () => {
    expect(() => bake(getTemplate('rollout'), parseParams('rollout', { posture: 'standing', direction: 'oblique' }, 'alternating'), skel)).toThrow(/variant not implemented/)
  })
})

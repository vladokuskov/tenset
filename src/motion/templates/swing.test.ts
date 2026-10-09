import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { centerOfPressure, fk, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'
import { ARM, HIKE, SWING_TEMPO, TOP } from './swing.ts'

const skel = testSkeleton()
const variants = motionRecords('swing')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('swing'), parseParams('swing', v.params, v.laterality), skel)]))
const b = baked.get(518)!
const at = (x: Baked, u: number) => Math.round(u * x.frames) % x.frames
const dof = (u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]
const bellAt = (i: number) => frameImplements(b, i).find((p) => p.id === 'kb')!.pos
/** loop fraction of the hike (end of the eccentric, mid bottom pause) */
const [ecc, pb, , pt] = SWING_TEMPO
const T = SWING_TEMPO.reduce((a, x) => a + x, 0)
const HIKE_U = (pt / 2 + ecc + pb / 2) / T

describe('swing template', () => {
  it('covers every swing record', () => {
    expect([...baked.keys()]).toEqual([518])
  })

  it('feet planted, both hands on the handle, finite frames, seamless loop', () => {
    expect(b.q.every(Number.isFinite)).toBe(true)
    const first = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i += 2) {
      const f = fk(skel, frameQ(b, i))
      const poses = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind === 'planted') expect(dist(sitePos(skel, f, c.site), sitePos(skel, first, c.site))).toBeLessThan(0.002)
        else if ('implement' in c.target) {
          const spec = b.implements.find((s) => s.id === (c.target as { implement: string }).implement)!
          expect(dist(sitePos(skel, f, c.site), siteWorld(spec, poses.find((p) => p.id === spec.id)!, (c.target as { grip: string }).grip).pos)).toBeLessThan(0.005)
        }
      }
    }
    const a = frameQ(b, 0), z = frameQ(b, b.frames - 1)
    for (const d of skel.dofs) if (d.unit === 'deg') expect(Math.abs(a[d.index] - z[d.index])).toBeLessThan(3)
  })

  it('ballistic tempo: a rep takes about 1.6 s, not the 3.7 s strength tempo', () => {
    expect(b.duration).toBeCloseTo(T, 5)
    expect(T).toBeLessThan(2)
  })

  it('float: standing tall (hips and knees open), the bell at about chest height on long arms', () => {
    expect(dof(0, 'hip_l.flex')).toBeCloseTo(TOP.hip, 0)
    expect(dof(0, 'knee_l.flex')).toBeLessThan(TOP.knee + 1)
    const f = fk(skel, frameQ(b, 0))
    const sh = (sitePos(skel, f, 'grip_l')[1] + sitePos(skel, f, 'grip_r')[1]) / 2
    const chest = f.pos[skel.seg.humerus_l][1]
    expect(Math.abs(sh - chest)).toBeLessThan(0.12)
    expect(ARM.top).toBeGreaterThan(80)
    expect(dof(0, 'elbow_l.flex')).toBeLessThan(10)
  })

  it('hike: hips folded ~80 deg, knees soft, the bell behind the legs', () => {
    const i = at(b, HIKE_U)
    expect(dof(HIKE_U, 'hip_l.flex')).toBeCloseTo(HIKE.hip, 0)
    expect(dof(HIKE_U, 'knee_l.flex')).toBeGreaterThan(20)
    expect(dof(HIKE_U, 'knee_l.flex')).toBeLessThan(40)
    const f = fk(skel, frameQ(b, i))
    const heel = Math.max(sitePos(skel, f, 'heel_l')[2], sitePos(skel, f, 'heel_r')[2])
    expect(bellAt(i)[2]).toBeLessThan(heel)
  })

  it('balance: the centre of pressure of body and bell stays over the midfoot', () => {
    for (let i = 0; i < b.frames; i += 2) {
      const f = fk(skel, frameQ(b, i))
      const [, z] = centerOfPressure(skel, f, [{ mass: b.implements[0].mass, pos: bellAt(i) }])
      const mid = (sitePos(skel, f, 'midfoot_l')[2] + sitePos(skel, f, 'midfoot_r')[2]) / 2
      expect(Math.abs(z - mid)).toBeLessThan(0.025)
    }
  })

  it('throws for variants it does not draw yet', () => {
    const t = getTemplate('swing')
    for (const raw of [{ implement: 'dumbbell' }, { height: 'overhead' }]) expect(() => t.sample(0, parseParams('swing', raw), skel)).toThrow(/variant not implemented yet/)
    expect(() => t.sample(0, parseParams('swing', {}, 'unilateral'), skel)).toThrow(/variant not implemented yet/)
  })
})

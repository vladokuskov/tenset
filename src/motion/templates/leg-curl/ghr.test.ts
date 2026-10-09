import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { fk, sitePos } from '../../fk.ts'
import { siteWorld } from '../../implements.ts'
import { dist } from '../../math.ts'
import { motionRecords, testSkeleton } from '../../testing.ts'
import { getTemplate, parseParams } from '../index.ts'
import { GHR } from './ghr.ts'

const skel = testSkeleton()
const rec = motionRecords('leg-curl').find((r) => r.id === 526)!
const b = bake(getTemplate('leg-curl'), parseParams('leg-curl', rec.params, rec.laterality), skel)
const at = (x: Baked, u: number) => Math.round(u * x.frames) % x.frames
const dof = (u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]

describe('leg-curl glute-ham raise (GHD)', () => {
  it('is the GHD variant of the bodyweight kneeling leg curl', () => {
    expect(rec.params).toMatchObject({ implement: 'bodyweight', posture: 'kneeling', support: 'ghd' })
    expect(b.implements.some((s) => s.kind === 'ghd')).toBe(true)
  })

  it('feet planted on the plate, palms on the shoulders, finite frames, seamless loop', () => {
    expect(b.q.every(Number.isFinite)).toBe(true)
    const first = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i += 3) {
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
    for (const d of skel.dofs) if (d.unit === 'deg') expect(Math.abs(a[d.index] - z[d.index])).toBeLessThan(1)
  })

  it('pivots about the knees with a straight body: upright (knee ~90) down to level (~5), shins level throughout', () => {
    expect(dof(0, 'knee_l.flex')).toBeCloseTo(GHR.top, 0)
    expect(dof(0.625, 'knee_l.flex')).toBeCloseTo(GHR.bottom, 0)
    for (let i = 0; i < b.frames; i += 4) {
      const q = frameQ(b, i)
      expect(q[skel.dof['hip_l.flex']]).toBe(GHR.hip)
      expect(q[skel.dof['lumbar.flex']]).toBe(0)
      const f = fk(skel, q)
      const knee = f.pos[skel.seg.tibia_l], ankle = f.pos[skel.seg.foot_l]
      expect(Math.abs(knee[1] - ankle[1])).toBeLessThan(0.01)
    }
  })

  it('the shins lie between the rollers and the soles on the plate, within the pad tolerance', () => {
    const spec = b.implements.find((s) => s.kind === 'ghd')!
    const [, , plate, top, low] = placeParts(spec, frameImplements(b, 0).find((p) => p.id === spec.id)!)
    const caps = bodyCapsules(skel, fk(skel, frameQ(b, 0)))
    const clear = (s: typeof plate, re: RegExp) => Math.min(...caps.filter((c) => re.test(c.region)).map((c) => capsuleSolidClearance(c, s)))
    expect(clear(plate, /^foot_/)).toBeGreaterThan(-0.015)
    expect(clear(plate, /^foot_/)).toBeLessThan(0.002)
    // the rollers close on the shins: neither sinks past the pad tolerance, the nearer one touches
    for (const r of [top, low]) expect(clear(r, /^shank_/)).toBeGreaterThan(-0.015)
    expect(Math.min(clear(top, /^shank_/), clear(low, /^shank_/))).toBeLessThan(0.002)
  })
})

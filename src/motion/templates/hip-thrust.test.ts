import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { FLOOR_MAT } from '../implements/shared.ts'
import { siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { FLOOR_GAP, HIP_BOTTOM, HIP_TOP } from './hip-thrust.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('hip-thrust')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('hip-thrust'), parseParams('hip-thrust', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]

describe('hip-thrust template', () => {
  it('covers every hip-thrust record in the family', () => {
    expect([...baked.keys()].sort()).toEqual([502, 511, 530])
  })

  it.each([...baked.keys()])('%i: feet planted, hands held, finite frames, seamless loop', (id) => {
    const b = get(id)
    expect(b.q.every(Number.isFinite)).toBe(true)
    const first = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i += 3) {
      const f = fk(skel, frameQ(b, i))
      const poses = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind === 'planted') expect(dist(sitePos(skel, f, c.site), sitePos(skel, first, c.site))).toBeLessThan(0.002)
        else if ('implement' in c.target) {
          const { implement, grip } = c.target
          const spec = b.implements.find((s) => s.id === implement)!
          expect(dist(sitePos(skel, f, c.site), siteWorld(spec, poses.find((p) => p.id === implement)!, grip).pos)).toBeLessThan(0.005)
        }
      }
    }
    const a = frameQ(b, 0), z = frameQ(b, b.frames - 1)
    for (const d of skel.dofs) if (d.unit === 'deg') expect(Math.abs(a[d.index] - z[d.index])).toBeLessThan(1)
  })

  it.each([...baked.keys()])('%i: lockout shins at the param angle (90 = vertical), hips just past neutral (ribs down), knee ROM ~21 +/- 7', (id) => {
    const b = get(id)
    const f = fk(skel, frameQ(b, 0))
    const knee = segPos(skel, f, 'tibia_l'), ankle = segPos(skel, f, 'foot_l')
    const shin = Math.atan2(ankle[2] - knee[2], knee[1] - ankle[1]) * (180 / Math.PI)
    expect(shin).toBeCloseTo(90 - Number(b.params.kneeAngle), 0)
    const hip = dof(b, 0, 'hip_l.flex')
    expect(hip).toBeLessThanOrEqual(0)
    expect(hip).toBeGreaterThan(HIP_TOP - 2)
    // ribs down: the lumbar spine never extends
    for (let i = 0; i < b.frames; i += 5) expect(frameQ(b, i)[skel.dof['lumbar.flex']]).toBeGreaterThanOrEqual(0)
    const rom = dof(b, 0.625, 'knee_l.flex') - dof(b, 0, 'knee_l.flex')
    expect(rom).toBeGreaterThan(10)
    expect(rom).toBeLessThan(30)
  })

  it.each([502, 530])('%i on the bench: shins vertical at lockout, ~75 deg hip flexion at the bottom, back on the edge, load on the hips', (id) => {
    const b = get(id)
    const f = fk(skel, frameQ(b, 0))
    expect(Math.abs(segPos(skel, f, 'tibia_l')[2] - segPos(skel, f, 'foot_l')[2])).toBeLessThan(0.02)
    expect(dof(b, 0.625, 'hip_l.flex')).toBeCloseTo(HIP_BOTTOM, 0)
    // chin tucked: the neck flexes further as the trunk levels out at lockout
    expect(dof(b, 0, 'neck.flex')).toBeGreaterThan(dof(b, 0.625, 'neck.flex') + 8)
    // hip ROM ~75 +/- 19 (Brazil 2021)
    const rom = dof(b, 0.625, 'hip_l.flex') - dof(b, 0, 'hip_l.flex')
    expect(rom).toBeGreaterThan(56)
    expect(rom).toBeLessThan(94)
    const bench = b.implements.find((s) => s.kind === 'thrust_bench')!
    const pad = placeParts(bench, { id: bench.id, pos: [0, 0, 0], rot: [0, 0, 0, 1] })[0]
    for (let i = 0; i < b.frames; i += 4) {
      const g = fk(skel, frameQ(b, i))
      const caps = bodyCapsules(skel, g)
      const back = Math.min(...caps.filter((c) => c.region === 'trunk').map((c) => capsuleSolidClearance(c, pad)))
      expect(back).toBeLessThan(0)
      expect(back).toBeGreaterThan(-0.015)
      const bar = frameImplements(b, i).find((p) => p.id === (id === 530 ? 'db' : 'bar'))!.pos
      expect(Math.abs(bar[2] - sitePos(skel, g, 'hip_crease')[2])).toBeLessThan(0.001)
      expect(bar[1]).toBeGreaterThan(segPos(skel, g, 'pelvis')[1])
    }
  })

  it('dumbbell on the bench: it lies across the hips on its heads, the palms on its end faces', () => {
    const b = get(530)
    const k = b.implements.findIndex((s) => s.id === 'db')
    for (let i = 0; i < b.frames; i += 4) {
      const f = fk(skel, frameQ(b, i))
      const solids = placeParts(b.implements[k], frameImplements(b, i)[k])
      const hips = bodyCapsules(skel, f).filter((c) => c.segment === 'pelvis' || c.segment.startsWith('lumbar') || c.region.startsWith('thigh_'))
      const gap = Math.min(...hips.flatMap((c) => solids.map((sd) => capsuleSolidClearance(c, sd))))
      expect(gap).toBeLessThan(0)
      expect(gap).toBeGreaterThan(-0.008)
      // each hand on its own end of the dumbbell
      const db = frameImplements(b, i)[k].pos
      expect(sitePos(skel, f, 'grip_l')[0] - db[0]).toBeGreaterThan(0.15)
      expect(sitePos(skel, f, 'grip_r')[0] - db[0]).toBeLessThan(-0.15)
    }
  })

  it('bridge on the mat: upper back and head stay down, butt just off the mat at the bottom', () => {
    const b = get(511)
    const top = FLOOR_MAT.thick
    const low = (i: number, test: (region: string, segment: string) => boolean) =>
      Math.min(...bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => test(c.region, c.segment)).map((c) => Math.min(c.a[1], c.b[1]) - c.r - top))
    for (let i = 0; i < b.frames; i += 4) {
      expect(low(i, (_, s) => s === 'thorax1' || s === 'thorax2')).toBeCloseTo(-0.008, 3)
      expect(low(i, (r) => r === 'head')).toBeLessThan(0.002)
    }
    expect(low(at(b, 0.625), (r, s) => r === 'trunk' && !s.startsWith('thorax'))).toBeCloseTo(FLOOR_GAP, 3)
    expect(dof(b, 0.625, 'hip_l.flex')).toBeGreaterThan(30)
  })

  it('throws for variants it does not draw yet', () => {
    const t = getTemplate('hip-thrust')
    for (const raw of [{ implement: 'dumbbell', support: 'floor' }, { implement: 'machine' }, { implement: 'barbell', support: 'floor' }]) {
      expect(() => t.sample(0, parseParams('hip-thrust', raw), skel)).toThrow(/variant not implemented yet/)
    }
  })
})

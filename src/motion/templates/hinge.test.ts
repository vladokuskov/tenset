import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleClearance } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { PLATE_20_RADIUS, siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { BOTTOM_HIP, SPINE, TOP_HIP, TOP_KNEE } from './hinge.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('hinge')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('hinge'), parseParams('hinge', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]
/** the working (stance) side: the single-leg record stands on its right leg */
const stance = (b: Baked) => (b.params.stance === 'single_leg' ? (b.params.side === 'left' ? 'l' : 'r') : 'l')

describe('hinge template', () => {
  it('covers every hinge record in the family', () => {
    expect([...baked.keys()].sort()).toEqual([501, 508, 509, 510, 513])
  })

  it.each([...baked.keys()])('%i: feet planted, hands on the load, finite frames, seamless loop', (id) => {
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
    // the loop is cut in the top pause: the last frame is next to the first
    const a = frameQ(b, 0), z = frameQ(b, b.frames - 1)
    for (const d of skel.dofs) if (d.unit === 'deg') expect(Math.abs(a[d.index] - z[d.index])).toBeLessThan(1)
  })

  it.each([...baked.keys()])('%i: lockout at hip and knee ~0 with no hyperextension, spine neutral through the rep', (id) => {
    const b = get(id)
    const s = stance(b)
    expect(dof(b, 0, `hip_${s}.flex`)).toBeCloseTo(TOP_HIP, 0)
    expect(dof(b, 0, `knee_${s}.flex`)).toBeCloseTo(TOP_KNEE, 0)
    for (let i = 0; i < b.frames; i += 4) {
      const q = frameQ(b, i)
      expect(q[skel.dof[`hip_${s}.flex`]]).toBeGreaterThan(-5)
      expect(Math.abs(q[skel.dof['lumbar.flex']])).toBeLessThanOrEqual(SPINE.lumbar + 0.01)
      expect(Math.abs(q[skel.dof['thorax.flex']])).toBeLessThanOrEqual(SPINE.thorax + 0.01)
    }
  })

  it('RDLs: knees held at ~15-25 deg while the hips flex to ~70-90 (research range)', () => {
    for (const id of [501, 509, 510]) {
      const b = get(id)
      const s = stance(b)
      expect(dof(b, 0.625, `knee_${s}.flex`)).toBeGreaterThanOrEqual(15)
      expect(dof(b, 0.625, `knee_${s}.flex`)).toBeLessThanOrEqual(25)
      const hip = dof(b, 0.625, `hip_${s}.flex`)
      expect(hip).toBeGreaterThanOrEqual(70)
      expect(hip).toBeLessThanOrEqual(90)
    }
    expect(dof(get(501), 0.625, 'hip_l.flex')).toBeCloseTo(BOTTOM_HIP.bar, 0)
  })

  it('barbell: bar over the midfoot all rep and close to the legs', () => {
    for (const id of [501, 508]) {
      const b = get(id)
      for (let i = 0; i < b.frames; i += 3) {
        const f = fk(skel, frameQ(b, i))
        const mid = (sitePos(skel, f, 'midfoot_l')[2] + sitePos(skel, f, 'midfoot_r')[2]) / 2
        const bar = frameImplements(b, i)[0].pos
        expect(Math.abs(bar[2] - mid)).toBeLessThan(0.025)
        // the bar rides the front of the legs (the floor pull a few cm off where the knees stick out, never in them)
        const legs = bodyCapsules(skel, f).filter((c) => /^(thigh|shank)_/.test(c.region))
        const gap = Math.min(...legs.map((c) => capsuleClearance(c, { a: [-0.655, bar[1], bar[2]], b: [0.655, bar[1], bar[2]], r: 0.014 })))
        expect(gap).toBeGreaterThan(-0.003)
        expect(gap).toBeLessThan(id === 501 ? 0.012 : 0.035)
      }
    }
  })

  it('conventional deadlift starts from the floor: plates on the floor, hips bent more than the knees', () => {
    const b = get(508)
    const bottom = frameImplements(b, at(b, 0.625))[0].pos
    expect(bottom[1]).toBeCloseTo(PLATE_20_RADIUS, 2)
    expect(dof(b, 0.625, 'hip_l.flex')).toBeGreaterThan(dof(b, 0.625, 'knee_l.flex') + 30)
    expect(dof(b, 0.625, 'knee_l.flex')).toBeGreaterThan(50)
  })

  it('single leg: the free leg swings up in line with the trunk as a lever and never touches down', () => {
    const b = get(510)
    const q = frameQ(b, at(b, 0.625))
    const trunk = q[skel.dof['lumbar.flex']] + q[skel.dof['thorax.flex']]
    expect(q[skel.dof['hip_l.flex']]).toBeCloseTo(-trunk, 0)
    expect(q[skel.dof['knee_l.flex']]).toBeLessThan(10)
    for (let i = 0; i < b.frames; i += 3) expect(sitePos(skel, fk(skel, frameQ(b, i)), 'toe_l')[1]).toBeGreaterThan(0.05)
  })

  it('pull-through: facing away from a low pulley, rope pulled back between the legs', () => {
    const b = get(513)
    const pulley = b.cables![0].pulley
    const f = fk(skel, frameQ(b, at(b, 0.625)))
    expect(pulley[1]).toBeLessThan(0.2)
    expect(pulley[2]).toBeLessThan(sitePos(skel, f, 'heel_l')[2] - 0.3)
    const rope = frameImplements(b, at(b, 0.625))[0].pos
    expect(Math.abs(rope[0])).toBeLessThan(0.01)
    expect(rope[2]).toBeLessThan(segPos(skel, f, 'tibia_l')[2])
    // fists side by side on the rope ends, inside the knees at the bottom
    const grip = sitePos(skel, f, 'grip_l')
    expect(grip[0]).toBeLessThan(0.1)
    expect(grip[0]).toBeLessThan(segPos(skel, f, 'tibia_l')[0] - 0.05)
  })

  it('throws for variants it does not draw yet', () => {
    const t = getTemplate('hinge')
    for (const raw of [{ implement: 'dumbbell', start: 'floor', hold: 'front_of_thighs' }, { implement: 'barbell', stance: 'single_leg' }, { implement: 'cable', attachment: 'single_handle' }]) {
      expect(() => t.sample(0, parseParams('hinge', raw), skel)).toThrow(/variant not implemented yet/)
    }
  })
})

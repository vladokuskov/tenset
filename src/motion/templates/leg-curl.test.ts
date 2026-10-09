import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import { loopDuration } from '../timing.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'
import { BENCH_CURL, LYING, STANDING_KNEE } from './leg-curl.ts'

const skel = testSkeleton()
const variants = motionRecords('leg-curl')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('leg-curl'), parseParams('leg-curl', v.params, v.laterality), skel)]))
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const bottomU = (b: Baked) => (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] / 2) / loopDuration(b.tempo)
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]

describe('leg-curl template', () => {
  it('covers the seated, lying, single-leg lying, standing cable, dumbbell and Nordic curls', () => {
    expect(variants.map((v) => v.id).sort()).toEqual([503, 504, 512, 526, 539, 540, 541])
  })

  it.each([503, 504, 539])('%s: knee ~5 -> 110-130 (research), hips held, hands on the handles', (id) => {
    const b = baked.get(id)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    // single leg: the right leg works
    const w = id === 539 ? 'r' : 'l'
    // top of the loop is the curl (the concentric end), the bottom the stretch
    expect(dof(b, 0, `knee_${w}.flex`)).toBeGreaterThan(110)
    expect(dof(b, 0, `knee_${w}.flex`)).toBeLessThan(130)
    expect(dof(b, bottomU(b), `knee_${w}.flex`)).toBeLessThan(10)
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

  it('single-leg lying: the other leg stays long on the pad', () => {
    const b = baked.get(539)!
    for (let i = 0; i < b.frames; i += 3) expect(frameQ(b, i)[skel.dof['knee_l.flex']]).toBeCloseTo(LYING.stretch, 6)
  })

  it('standing cable: the strapped knee ~25 -> 100 with the thigh held near vertical, standing on the other leg', () => {
    const b = baked.get(540)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    expect(dof(b, 0, 'knee_r.flex')).toBeCloseTo(STANDING_KNEE.curl, 0)
    expect(dof(b, bottomU(b), 'knee_r.flex')).toBeCloseTo(STANDING_KNEE.stretch, 0)
    expect(STANDING_KNEE.curl).toBeGreaterThanOrEqual(90)
    const f0 = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      const f = fk(skel, q)
      // the stance foot stays planted and its knee nearly straight
      for (const c of b.contacts.filter((x) => x.kind === 'planted')) expect(dist(sitePos(skel, f, c.site), sitePos(skel, f0, c.site))).toBeLessThan(0.002)
      expect(q[skel.dof['knee_l.flex']]).toBeLessThan(8)
      // the thigh stays within ~15 deg of vertical (the knee does not swing forward)
      const hip = segPos(skel, f, 'femur_r'), knee = segPos(skel, f, 'tibia_r')
      expect(Math.atan2(Math.hypot(knee[0] - hip[0], knee[2] - hip[2]), hip[1] - knee[1]) / (Math.PI / 180)).toBeLessThan(15)
      // the working foot stays off the floor
      expect(sitePos(skel, f, 'heel_r')[1]).toBeGreaterThan(0.01)
      const impl = frameImplements(b, i)
      for (const c of b.contacts.filter((x) => x.kind === 'grip')) {
        const j = b.implements.findIndex((s) => s.id === (c.target as { implement: string }).implement)
        expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[j], impl[j], (c.target as { grip: string }).grip).pos)).toBeLessThan(0.005)
      }
    }
    expect(b.cables?.length).toBe(1)
  })

  it('dumbbell prone on a bench: knees ~45 -> 95 (shins near vertical), hips on the pad, the feet holding the dumbbell', () => {
    const b = baked.get(541)!
    expect(dof(b, 0, 'knee_l.flex')).toBeCloseTo(BENCH_CURL.curl, 0)
    expect(dof(b, bottomU(b), 'knee_l.flex')).toBeCloseTo(BENCH_CURL.stretch, 0)
    const k = b.implements.findIndex((s) => s.id === 'db')
    const pelvis0 = segPos(skel, fk(skel, frameQ(b, 0)), 'pelvis')
    for (let i = 0; i < b.frames; i += 3) {
      const q = frameQ(b, i)
      const f = fk(skel, q)
      expect(dist(segPos(skel, f, 'pelvis'), pelvis0)).toBeLessThan(0.001)
      expect(Math.abs(q[skel.dof['hip_l.flex']])).toBeLessThan(1)
      // the dumbbell sits between the feet, its handle at the midfeet
      const db = frameImplements(b, i)[k].pos
      const [l, r] = [sitePos(skel, f, 'midfoot_l'), sitePos(skel, f, 'midfoot_r')]
      expect(Math.abs(db[0])).toBeLessThan(0.001)
      expect(dist(db, [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2])).toBeLessThan(0.1)
    }
  })

  it.each([
    ['kneeling machine', { posture: 'kneeling', implement: 'machine' }],
    ['seated single leg', { laterality: 'unilateral' }],
    ['cable lying', { posture: 'lying_prone', implement: 'cable' }],
  ])('%s: throws variant not implemented yet', (_, params) => {
    expect(() => getTemplate('leg-curl').setup(parseParams('leg-curl', params), skel)).toThrow(/variant not implemented yet/)
  })
})

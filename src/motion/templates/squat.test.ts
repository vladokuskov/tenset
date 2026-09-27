import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { centerOfMass, fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, qrot } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('squat')
const run = (raw: Record<string, unknown>) => bake(getTemplate('squat'), parseParams('squat', raw), skel)
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
/** trunk angle from vertical at the bottom of the rep, deg */
const bottomLean = (b: Baked) => {
  const q = frameQ(b, at(b, 0.625))
  return q[skel.dof['pelvis.tilt']] + q[skel.dof['lumbar.flex']] + q[skel.dof['thorax.flex']]
}

describe('squat template', () => {
  it.each(variants.map((v) => [v.slug, v] as const))('%s: feet stay planted and every frame is finite', (_, v) => {
    const b = bake(getTemplate('squat'), parseParams('squat', v.params, v.laterality), skel)
    expect(b.q.every(Number.isFinite)).toBe(true)
    const planted = b.contacts.filter((c) => c.kind === 'planted')
    const first = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i += 5) {
      const f = fk(skel, frameQ(b, i))
      for (const c of planted) expect(dist(sitePos(skel, f, c.site), sitePos(skel, first, c.site))).toBeLessThan(0.002)
    }
  })

  it('trunk lean falls out of where the bar sits: low bar > high bar > front rack', () => {
    const depth = { depth: 'parallel' }
    const low = bottomLean(run({ hold: 'back_low', ...depth }))
    const high = bottomLean(run({ hold: 'back_high', ...depth }))
    const front = bottomLean(run({ hold: 'front_rack', ...depth }))
    expect(low).toBeGreaterThan(high + 5)
    expect(high).toBeGreaterThan(front + 10)
    expect(front).toBeGreaterThan(10)
  })

  it('a feet-forward Smith squat stays clearly more upright than a free back squat at the same depth', () => {
    const free = bottomLean(run({ hold: 'back_high', depth: 'parallel' }))
    const smith = bottomLean(run({ implement: 'smith', hold: 'back_high', footPosition: 'forward', depth: 'parallel' }))
    expect(smith).toBeLessThan(free - 10)
  })

  it('keeps a free bar over the midfoot and a Smith bar on its rail', () => {
    for (const [raw, line] of [[{ hold: 'back_high' }, 'midfoot'], [{ implement: 'smith', hold: 'back_high', footPosition: 'forward', depth: 'parallel' }, 'rail']] as const) {
      const b = run(raw)
      for (let i = 0; i < b.frames; i += 3) {
        const bar = frameImplements(b, i)[0].pos
        const f = fk(skel, frameQ(b, i))
        const target = line === 'rail' ? 0 : (sitePos(skel, f, 'midfoot_l')[2] + sitePos(skel, f, 'midfoot_r')[2]) / 2
        expect(Math.abs(bar[2] - target)).toBeLessThan(0.01)
      }
    }
  })

  it('goes deeper with depth and lets the knees travel over the toes (knees outside the hip-ankle line)', () => {
    const knee = (depth: string) => frameQ(run({ hold: 'back_high', depth }), 70)[skel.dof['knee_l.flex']]
    expect(knee('quarter')).toBeLessThan(knee('parallel'))
    expect(knee('parallel')).toBeLessThan(knee('full'))
    const b = run({ hold: 'back_high', depth: 'full' })
    const f = fk(skel, frameQ(b, at(b, 0.625)))
    const [hip, kneeP, ankle] = ['femur_l', 'tibia_l', 'foot_l'].map((s) => segPos(skel, f, s))
    const onLine = hip[0] + ((ankle[0] - hip[0]) * (hip[1] - kneeP[1])) / (hip[1] - ankle[1])
    expect(kneeP[0]).toBeGreaterThan(onLine)
  })

  it('front squat: fingertips on the bar with the wrists extended past the default 70 deg limit (front rack only)', () => {
    const b = run({ implement: 'barbell', hold: 'front_rack', depth: 'full', gripWidth: 1.5 })
    expect(b.limits?.['wrist_l.flex']).toEqual([-90, 75])
    expect(b.contacts.filter((c) => c.site.startsWith('fingers_'))).toHaveLength(2)
    for (let i = 0; i < b.frames; i += 7) {
      const q = frameQ(b, i)
      expect(q[skel.dof['wrist_l.flex']]).toBeLessThan(-70)
      expect(q[skel.dof['wrist_l.flex']]).toBeGreaterThanOrEqual(-90.01)
      const f = fk(skel, q)
      const bar = frameImplements(b, i)[0]
      for (const s of ['l', 'r'] as const) expect(dist(sitePos(skel, f, `fingers_${s}`), siteWorld(b.implements[0], bar, s).pos)).toBeLessThan(0.005)
    }
    expect(run({ hold: 'back_high' }).limits).toBeUndefined()
  })

  it('front rack: elbows up near horizontal, the bar resting on the delts and clear of the throat', () => {
    const b = run({ implement: 'barbell', hold: 'front_rack', depth: 'full', gripWidth: 1.5 })
    expect(frameQ(b, 0)[skel.dof['shoulder_l.elev']]).toBeGreaterThan(75)
    for (let i = 0; i < b.frames; i += 7) {
      const caps = bodyCapsules(skel, fk(skel, frameQ(b, i)))
      const [shaft] = placeParts(b.implements[0], frameImplements(b, i)[0])
      const clear = (re: RegExp) => Math.min(...caps.filter((c) => re.test(c.region)).map((c) => capsuleSolidClearance(c, shaft)))
      expect(clear(/^(neck|head)$/)).toBeGreaterThan(0.01)
      expect(clear(/^(upperarm|girdle)_/)).toBeLessThan(0)
    }
  })

  it('goblet: the dumbbell stands vertical against the chest, both palms under the top head, elbows down', () => {
    const b = run({ implement: 'dumbbell', hold: 'goblet', depth: 'full' })
    const k = b.implements.findIndex((s) => s.id === 'db')
    const db = b.implements[k]
    for (let i = 0; i < b.frames; i += 7) {
      const pose = frameImplements(b, i)[k]
      expect(qrot(pose.rot, [1, 0, 0])[1]).toBeCloseTo(1, 6)
      const f = fk(skel, frameQ(b, i))
      const chest = bodyCapsules(skel, f).filter((c) => c.region === 'trunk')
      const heads = placeParts(db, pose).slice(1)
      expect(Math.min(...heads.flatMap((h) => chest.map((c) => capsuleSolidClearance(c, h))))).toBeLessThan(0.002)
      for (const s of ['l', 'r'] as const) {
        const cup = siteWorld(db, pose, `cup_${s}`).pos
        expect(dist(sitePos(skel, f, `grip_${s}`), cup)).toBeLessThan(0.005)
        expect(cup[1] - pose.pos[1]).toBeGreaterThan(0)
        expect(cup[1] - pose.pos[1]).toBeLessThan(0.065)
        expect(segPos(skel, f, `forearm_${s}`)[1]).toBeLessThan(sitePos(skel, f, `grip_${s}`)[1] - 0.15)
      }
    }
  })

  it('unloaded squat keeps the centre of mass toward the heel for a more upright trunk', () => {
    const b = run({ implement: 'bodyweight', hold: 'hands', depth: 'full', armPosition: 'forward' })
    expect(b.balance?.target).toBeLessThan(0)
    const q = frameQ(b, at(b, 0.625))
    const f = fk(skel, q)
    const mid = (sitePos(skel, f, 'midfoot_l')[2] + sitePos(skel, f, 'midfoot_r')[2]) / 2
    expect(centerOfMass(skel, f)[2] - mid).toBeCloseTo(b.balance!.target!, 2)
    // trunk lean at the bottom was 48 deg with the COM held over the midfoot
    expect(bottomLean(b)).toBeLessThan(40)
  })

  it('leg press: pelvis fixed to the seat, feet ride the sled, hip flexion stays in range', () => {
    const b = run({ implement: 'machine', machine: 'leg_press', sledAngle: 45, footPosition: 'mid', stance: 'hip' })
    const p0 = frameQ(b, 0).slice(skel.dof['pelvis.tx'], skel.dof['pelvis.tz'] + 1)
    let travel = 0
    for (let i = 0; i < b.frames; i += 3) {
      const q = frameQ(b, i)
      expect(q.slice(skel.dof['pelvis.tx'], skel.dof['pelvis.tz'] + 1)).toEqual(p0)
      expect(q[skel.dof['hip_l.flex']]).toBeLessThanOrEqual(112.5)
      const sled = frameImplements(b, i)[0]
      const f = fk(skel, q)
      expect(dist(sitePos(skel, f, 'heel_l'), siteWorld(b.implements[0], sled, 'heel_l').pos)).toBeLessThan(0.002)
      travel = Math.max(travel, dist(sled.pos, frameImplements(b, 0)[0].pos))
    }
    expect(travel).toBeGreaterThan(0.15)
  })
})

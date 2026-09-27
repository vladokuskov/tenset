import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import { testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
type Variant = { slug: string; template: string; laterality: string; params: Record<string, unknown> }
const variants = (JSON.parse(readFileSync(new URL('../../../data/motion-templates/variants.json', import.meta.url), 'utf8')) as Variant[]).filter((v) => v.template === 'squat')
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

  it('leg press: pelvis fixed to the seat, feet ride the sled, hip flexion stays in range', () => {
    const b = run({ implement: 'machine', machine: 'leg_press', sledAngle: 45, footPosition: 'mid', stance: 'hip' })
    const p0 = frameQ(b, 0).slice(skel.dof['pelvis.tx'], skel.dof['pelvis.tz'] + 1)
    let travel = 0
    for (let i = 0; i < b.frames; i += 3) {
      const q = frameQ(b, i)
      expect(q.slice(skel.dof['pelvis.tx'], skel.dof['pelvis.tz'] + 1)).toEqual(p0)
      expect(q[skel.dof['hip_l.flex']]).toBeLessThanOrEqual(128.5)
      const sled = frameImplements(b, i)[0]
      const f = fk(skel, q)
      expect(dist(sitePos(skel, f, 'heel_l'), siteWorld(b.implements[0], sled, 'heel_l').pos)).toBeLessThan(0.002)
      travel = Math.max(travel, dist(sled.pos, frameImplements(b, 0)[0].pos))
    }
    expect(travel).toBeGreaterThan(0.2)
  })
})

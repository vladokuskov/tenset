import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts } from '../collide.ts'
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
  }, 30_000)

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

  it('goblet (405): toes out 30, the squat bottoms out with the elbows inside the knees, arms resting on the thighs', () => {
    const v = variants.find((x) => x.slug.startsWith('405-'))!
    expect(v.params.toeOut).toBe(30)
    const b = bake(getTemplate('squat'), parseParams('squat', v.params, v.laterality), skel)
    const f = fk(skel, frameQ(b, at(b, 0.625)))
    const caps = bodyCapsules(skel, f)
    for (const s of ['l', 'r'] as const) {
      const elbow = Math.abs(segPos(skel, f, `forearm_${s}`)[0]), knee = Math.abs(segPos(skel, f, `tibia_${s}`)[0])
      expect(knee - elbow).toBeGreaterThan(0.015)
      const arms = caps.filter((c) => c.region === `upperarm_${s}` || c.region === `forearm_${s}`)
      const thighs = caps.filter((c) => c.region === `thigh_${s}`)
      const gap = Math.min(...arms.flatMap((a) => thighs.map((t) => capsuleClearance(a, t))))
      // a light touch inside the 12 mm arm-thigh tolerance
      expect(gap).toBeLessThan(0)
      expect(gap).toBeGreaterThan(-0.012)
    }
    // shallower than the depth table's full squat: the arms stop it
    expect(frameQ(b, at(b, 0.625))[skel.dof['knee_l.flex']]).toBeLessThan(118)
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

  it('single-leg press: one foot rides the sled, the resting leg stays still and clear', () => {
    const v = variants.find((x) => x.id === 429)!
    const b = bake(getTemplate('squat'), parseParams('squat', v.params, v.laterality), skel)
    const feet = b.contacts.filter((c) => c.kind === 'grip' && /^(heel|ball)_/.test(c.site))
    expect(feet.map((c) => c.site).sort()).toEqual(['ball_r', 'heel_r'])
    const knee = (u: number, s: string) => frameQ(b, at(b, u))[skel.dof[`knee_${s}.flex`]]
    expect(knee(0.625, 'r') - knee(0, 'r')).toBeGreaterThan(50)
    expect(Math.abs(knee(0.625, 'l') - knee(0, 'l'))).toBeLessThan(1e-6)
    for (let i = 0; i < b.frames; i += 3) expect(frameQ(b, i)[skel.dof['hip_r.flex']]).toBeLessThanOrEqual(112.5)
  })

  // ---------- wave 3b: kettlebells, the sumo hang, heels on a plate, the box ----------

  const rec = (id: number) => {
    const v = variants.find((x) => x.id === id)!
    return bake(getTemplate('squat'), parseParams('squat', v.params, v.laterality), skel)
  }
  const grips = (b: Baked, i: number) => {
    const f = fk(skel, frameQ(b, i))
    const impl = frameImplements(b, i)
    return Math.max(...b.contacts.filter((c) => c.kind === 'grip' && 'implement' in c.target).map((c) => {
      const t = c.target as { implement: string; grip: string }
      const k = b.implements.findIndex((s) => s.id === t.implement)
      return dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], t.grip).pos)
    }))
  }

  it('kettlebell goblet (417): upright against the chest, the hands on the horns', () => {
    const b = rec(417)
    const k = b.implements.findIndex((s) => s.kind === 'kettlebell')
    for (let i = 0; i < b.frames; i += 7) {
      const pose = frameImplements(b, i)[k]
      expect(qrot(pose.rot, [0, 1, 0])[1]).toBeCloseTo(1, 6)
      expect(grips(b, i)).toBeLessThan(0.005)
      const chest = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region === 'trunk')
      const bell = placeParts({ ...b.implements[k], parts: b.implements[k].parts.slice(0, 6) }, pose)
      expect(Math.min(...bell.flatMap((p) => chest.map((c) => capsuleSolidClearance(c, p))))).toBeLessThan(0.002)
    }
  }, 30_000)

  it('double kettlebell front rack (418): hands at the collarbones, the forearms through the handles, bells clear of the thighs', () => {
    const b = rec(418)
    const bell = (k: number) => ({ ...b.implements[k], parts: b.implements[k].parts.slice(0, 6) })
    for (let i = 0; i < b.frames; i += 5) {
      expect(grips(b, i)).toBeLessThan(0.005)
      const f = fk(skel, frameQ(b, i))
      const caps = bodyCapsules(skel, f)
      for (const [k, s] of [[0, 'l'], [1, 'r']] as const) {
        const pose = frameImplements(b, i)[k]
        // the handle's window rides by the forearm (within 7.5 cm of its axis)
        const win = siteWorld(b.implements[k], pose, 'window').pos
        const elbow = segPos(skel, f, `forearm_${s}`), wrist = segPos(skel, f, `hand_${s}`)
        const d = [wrist[0] - elbow[0], wrist[1] - elbow[1], wrist[2] - elbow[2]] as const
        const t = Math.max(0, Math.min(1, ((win[0] - elbow[0]) * d[0] + (win[1] - elbow[1]) * d[1] + (win[2] - elbow[2]) * d[2]) / (d[0] ** 2 + d[1] ** 2 + d[2] ** 2)))
        expect(dist(win, [elbow[0] + t * d[0], elbow[1] + t * d[1], elbow[2] + t * d[2]])).toBeLessThan(0.075)
        // the bell lies on the outside of the forearm, lateral of the wrist and not in front of it
        const out = s === 'l' ? 1 : -1
        expect((pose.pos[0] - wrist[0]) * out).toBeGreaterThan(0.05)
        expect(pose.pos[2]).toBeLessThan(wrist[2])
        expect(pose.pos[1]).toBeLessThan(sitePos(skel, f, `grip_${s}`)[1] + 0.03)
        const thighs = caps.filter((c) => c.region.startsWith('thigh_'))
        expect(Math.min(...placeParts(bell(k), pose).flatMap((p) => thighs.map((c) => capsuleSolidClearance(c, p))))).toBeGreaterThan(0)
      }
    }
    // the bells or the tucked elbows stop the squat above the depth table's full depth
    expect(frameQ(b, at(b, 0.625))[skel.dof['knee_l.flex']]).toBeLessThan(118)
  }, 30_000)

  it('heels on a plate (420): heels up on the plate, balls on the floor, the knees travel further forward than flat', () => {
    const b = rec(420)
    const k = b.implements.findIndex((s) => s.id === 'plate')
    const top = frameImplements(b, 0)[k].pos[1] * 2
    const flat = run({ ...variants.find((x) => x.id === 420)!.params, heelsElevated: false })
    const shin = (bb: Baked) => {
      const f = fk(skel, frameQ(bb, at(bb, 0.625)))
      return segPos(skel, f, 'tibia_l')[2] - segPos(skel, f, 'foot_l')[2]
    }
    for (let i = 0; i < b.frames; i += 7) {
      const f = fk(skel, frameQ(b, i))
      expect(sitePos(skel, f, 'heel_l')[1]).toBeCloseTo(top, 3)
      expect(sitePos(skel, f, 'ball_l')[1]).toBeCloseTo(0, 3)
    }
    expect(shin(b)).toBeGreaterThan(shin(flat) + 0.02)
  }, 30_000)

  it('sumo (421): wide turned-out stance, one dumbbell hanging upright from both hands, clear of the floor', () => {
    const b = rec(421)
    const k = b.implements.findIndex((s) => s.id === 'db')
    expect(frameQ(b, 0)[skel.dof['knee_l.flex']]).toBeGreaterThan(8)
    for (let i = 0; i < b.frames; i += 5) {
      const pose = frameImplements(b, i)[k]
      expect(qrot(pose.rot, [1, 0, 0])[1]).toBeCloseTo(1, 6)
      expect(grips(b, i)).toBeLessThan(0.005)
      const low = Math.min(...placeParts(b.implements[k], pose).map((p) => (p.geo.shape === 'cylinder' ? Math.min(p.geo.a[1], p.geo.b[1]) : p.center[1])))
      expect(low).toBeGreaterThan(0.02)
    }
    const f = fk(skel, frameQ(b, 0))
    expect(sitePos(skel, f, 'midfoot_l')[0] - sitePos(skel, f, 'midfoot_r')[0]).toBeGreaterThan(0.6)
  }, 30_000)

  it('sumo (421): the dumbbell hangs near plumb under the shoulders on near-straight arms, between the knees at the bottom', () => {
    const b = rec(421)
    const k = b.implements.findIndex((s) => s.id === 'db')
    const ahead = (i: number) => {
      const f = fk(skel, frameQ(b, i))
      return frameImplements(b, i)[k].pos[2] - (segPos(skel, f, 'humerus_l')[2] + segPos(skel, f, 'humerus_r')[2]) / 2
    }
    for (let i = 0; i < b.frames; i += 5) {
      // only as far forward as the thighs make it at the top
      expect(ahead(i)).toBeLessThan(0.18)
      expect(frameQ(b, i)[skel.dof['elbow_l.flex']]).toBeLessThan(25)
    }
    const bottom = at(b, 0.625)
    expect(ahead(bottom)).toBeLessThan(0.08)
    expect(frameImplements(b, bottom)[k].pos[2]).toBeLessThan(segPos(skel, fk(skel, frameQ(b, bottom)), 'tibia_l')[2] + 0.03)
  }, 30_000)

  it('box squat (422): sits back onto the box at the bottom, clear of it standing, a longer pause on the box', () => {
    const b = rec(422)
    expect(b.tempo[1]).toBeGreaterThan(0.5)
    const k = b.implements.findIndex((s) => s.id === 'box')
    const box = (i: number) => {
      const caps = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region === 'trunk')
      return Math.min(...placeParts(b.implements[k], frameImplements(b, i)[k]).flatMap((p) => caps.map((c) => capsuleSolidClearance(c, p))))
    }
    expect(box(at(b, 0.62))).toBeLessThan(0)
    expect(box(at(b, 0.62))).toBeGreaterThan(-0.015)
    expect(box(0)).toBeGreaterThan(0.1)
    // more upright shins than the plain back squat at the same depth: the hips sit back
    const plain = run({ hold: 'back_high', stance: 'shoulder', toeOut: 30, depth: 'parallel' })
    expect(frameQ(b, at(b, 0.62))[skel.dof['ankle_l.df']]).toBeLessThan(frameQ(plain, at(plain, 0.625))[skel.dof['ankle_l.df']])
  }, 30_000)

  it('throws for the new holds where they do not fit', () => {
    const t = getTemplate('squat')
    for (const raw of [{ implement: 'kettlebell', hold: 'sides' }, { implement: 'dumbbell', hold: 'goblet', box: true }, { implement: 'barbell', hold: 'back_high', heelsElevated: true }]) {
      expect(() => t.setup(parseParams('squat', raw), skel)).toThrow(/variant not implemented yet/)
    }
  })
})

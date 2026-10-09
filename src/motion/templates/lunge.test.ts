import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules } from '../collide.ts'
import { centerOfMass, fk, localToWorld, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import { loopDuration } from '../timing.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('lunge')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('lunge'), parseParams('lunge', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
/** middle of the bottom pause */
const bottomU = (b: Baked) => {
  const [ecc, pb, , pt] = b.tempo
  return (pt / 2 + ecc + pb / 2) / loopDuration(b.tempo)
}
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]
const trunkLean = (b: Baked, u: number) => dof(b, u, 'pelvis.tilt') + dof(b, u, 'lumbar.flex') + dof(b, u, 'thorax.flex')

describe('lunge template', () => {
  it('covers every lunge record: split squats, reverse, forward, lateral and curtsy lunges, step-up, walking lunge, cossack', () => {
    expect(variants.map((v) => v.id).sort()).toEqual([403, 409, 410, 411, 423, 424, 425, 426, 427, 430, 431, 433, 434])
  })

  it.each(variants.map((v) => [v.slug, v.id] as const))('%s: finite, planted feet still, dumbbells in the hands, loop closes', (_, id) => {
    const b = get(id)
    expect(b.q.every(Number.isFinite)).toBe(true)
    const f0 = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind === 'planted') expect(dist(sitePos(skel, f, c.site), sitePos(skel, f0, c.site)), c.site).toBeLessThan(0.002)
        if (c.kind !== 'grip' || !('implement' in c.target)) continue
        const k = b.implements.findIndex((s) => s.id === (c.target as { implement: string }).implement)
        expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], c.target.grip).pos)).toBeLessThan(0.005)
      }
    }
    // seam: the last frame leads into the first as smoothly as any neighbouring pair
    const step = (i: number, j: number) => Math.max(...Array.from(frameQ(b, i), (x, k) => Math.abs(x - frameQ(b, j)[k])))
    expect(step(b.frames - 1, 0)).toBeLessThan(0.5)
  })

  it('front knee ~5 -> 90-100 (research: lunge front knee 0 -> 90-100), torso within torsoAngle of upright', () => {
    for (const id of [403, 409, 411, 424, 425]) {
      const b = get(id)
      expect(dof(b, 0, 'knee_r.flex'), `${id} top`).toBeLessThan(6)
      const knee = dof(b, bottomU(b), 'knee_r.flex')
      expect(knee, `${id} bottom`).toBeGreaterThan(90)
      // the split squat sinks a little deeper than the research's 90-100
      expect(knee, `${id} bottom`).toBeLessThan(id === 403 ? 106 : 101)
      expect(trunkLean(b, bottomU(b)), `${id} lean`).toBeLessThan((b.params.torsoAngle as number) + 1)
      expect(trunkLean(b, 0), `${id} lean top`).toBeLessThan(5)
    }
  })

  it('rear knee drops towards the floor: 80-100 deg on the lunges, deeper with the foot on the bench; rear hip open', () => {
    for (const id of [409, 411, 424, 425]) {
      const b = get(id)
      const knee = dof(b, bottomU(b), 'knee_l.flex')
      expect(knee, `${id}`).toBeGreaterThan(80)
      expect(knee, `${id}`).toBeLessThan(100)
      const hip = dof(b, bottomU(b), 'hip_l.flex')
      expect(hip, `${id} rear hip`).toBeGreaterThan(-20)
      expect(hip, `${id} rear hip`).toBeLessThan(10)
    }
    const bss = get(403)
    expect(dof(bss, bottomU(bss), 'knee_l.flex')).toBeGreaterThan(95)
    expect(dof(bss, bottomU(bss), 'knee_l.flex')).toBeLessThan(120)
    // the rear hip stays extended all the way (hip flexor stretch of the split squat)
    for (let i = 0; i < bss.frames; i++) expect(frameQ(bss, i)[skel.dof['hip_l.flex']]).toBeLessThan(-5)
    for (const id of [403, 409, 411]) {
      const b = get(id)
      const caps = bodyCapsules(skel, fk(skel, frameQ(b, at(b, bottomU(b))))).filter((c) => /^(thigh|shank)_l$/.test(c.region))
      const low = Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r))
      expect(low, `${id} rear knee over the floor`).toBeGreaterThan(0.02)
      expect(low, `${id} rear knee near the floor`).toBeLessThan(0.12)
    }
  })

  it('front knee tracks the toes: the knee stays over the line of the front foot', () => {
    for (const id of [403, 409, 410, 411]) {
      const b = get(id)
      for (let i = 0; i < b.frames; i += 3) {
        const f = fk(skel, frameQ(b, i))
        const knee = segPos(skel, f, 'tibia_r'), heel = sitePos(skel, f, 'heel_r'), toe = sitePos(skel, f, 'toe_r')
        // planted and bent (the forward lunge's front foot is in the air part of the time)
        if (frameQ(b, i)[skel.dof['knee_r.flex']] < 30 || heel[1] > (id === 410 ? 0.455 : 0.005)) continue
        // lateral distance of the knee from the heel-toe line, in the floor plane
        const [dx, dz] = [toe[0] - heel[0], toe[2] - heel[2]]
        // + inside (towards the midline), - outside the foot
        const off = ((knee[0] - heel[0]) * dz - (knee[2] - heel[2]) * dx) / Math.hypot(dx, dz)
        if (id !== 410) expect(Math.abs(off), `${id} @${i}`).toBeLessThan(0.045)
        else {
          // standing on the box foot the hip joint sits ~9 cm outside it (the centre of mass is over the foot), so the
          // knee bending in the toes' plane lies outside the foot line; it never caves in towards the midline
          expect(off, `${id} @${i}`).toBeGreaterThan(-0.105)
          expect(off, `${id} @${i}`).toBeLessThan(0.015)
        }
      }
    }
  })

  it('only the feet reach the floor (the floor tolerance for a foot on its ball covers nothing else), swings clear it', () => {
    for (const [id, b] of baked) {
      for (let i = 0; i < b.frames; i++) {
        for (const c of bodyCapsules(skel, fk(skel, frameQ(b, i)))) {
          if (c.region.startsWith('foot_')) continue
          expect(Math.min(c.a[1], c.b[1]) - c.r, `${id} ${c.name} @${i}`).toBeGreaterThan(-0.005)
        }
      }
    }
    // the moving foot clears the floor on the step down and on the step home
    for (const [id, side] of [[409, 'l'], [411, 'r'], [410, 'l']] as const) {
      const b = get(id)
      const lift = (from: number, to: number) => {
        let best = -Infinity
        for (let i = at(b, from); i < at(b, to); i++) {
          const caps = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region === `foot_${side}`)
          best = Math.max(best, Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r)))
        }
        return best
      }
      expect(lift(0.07, bottomU(b)), `${id} down`).toBeGreaterThan(0.03)
      expect(lift(bottomU(b), 0.93), `${id} up`).toBeGreaterThan(0.03)
    }
  })

  it('reverse lunge lands the back foot on its ball; the walking lunge keeps its back ball planted', () => {
    const rev = get(409)
    const f = fk(skel, frameQ(rev, at(rev, bottomU(rev))))
    expect(Math.abs(sitePos(skel, f, 'ball_l')[1])).toBeLessThan(0.005)
    expect(sitePos(skel, f, 'heel_l')[1]).toBeGreaterThan(0.08)
    expect(sitePos(skel, f, 'ball_l')[2]).toBeLessThan(sitePos(skel, f, 'heel_r')[2] - 0.6)
    const walk = get(411)
    expect(walk.contacts.map((c) => c.site)).toEqual(['grip_l', 'grip_r', 'ball_l'])
    // the front foot steps out and comes back home
    const fb = fk(skel, frameQ(walk, at(walk, bottomU(walk)))), f0 = fk(skel, frameQ(walk, 0))
    expect(sitePos(skel, fb, 'heel_r')[2] - sitePos(skel, f0, 'heel_r')[2]).toBeGreaterThan(0.6)
  })

  it('split squat: the rear foot rests still on the bench, top of the foot down', () => {
    const b = get(403)
    const k = b.implements.findIndex((s) => s.id === 'split_bench')
    const top = siteWorld(b.implements[k], frameImplements(b, 0)[k], 'top').pos[1]
    const a0 = segPos(skel, fk(skel, frameQ(b, 0)), 'foot_l')
    for (let i = 0; i < b.frames; i += 4) {
      const f = fk(skel, frameQ(b, i))
      expect(dist(segPos(skel, f, 'foot_l'), a0)).toBeLessThan(0.001)
      // the toes lie back along the pad
      expect(Math.abs(segPos(skel, f, 'toes_l')[1] - top - 0.02)).toBeLessThan(0.02)
    }
    expect(b.limits?.['ankle_l.df']).toEqual([-70, 40])
  })

  it('step-up: both feet on the box at the top, the working foot stays there, the other one steps down behind it', () => {
    const b = get(410)
    const k = b.implements.findIndex((s) => s.kind === 'plyo_box')
    const boxTop = siteWorld(b.implements[k], frameImplements(b, 0)[k], 'top').pos[1]
    expect(boxTop).toBeCloseTo(0.45, 3)
    const f0 = fk(skel, frameQ(b, 0)), fb = fk(skel, frameQ(b, at(b, bottomU(b))))
    // top: standing tall on the box with both feet (no knee drive)
    for (const s of ['l', 'r']) expect(sitePos(skel, f0, `heel_${s}`)[1], s).toBeCloseTo(boxTop, 2)
    expect(dof(b, 0, 'knee_r.flex')).toBeLessThan(6)
    expect(dof(b, 0, 'hip_l.flex')).toBeLessThan(6)
    // bottom: the trailing foot down behind the box, the box knee bent for a knee-height box
    expect(Math.abs(sitePos(skel, fb, 'ball_l')[1])).toBeLessThan(0.005)
    expect(sitePos(skel, fb, 'toe_l')[2]).toBeLessThan(siteWorld(b.implements[k], frameImplements(b, 0)[k], 'back').pos[2] - 0.05)
    const knee = dof(b, bottomU(b), 'knee_r.flex')
    expect(knee).toBeGreaterThan(100)
    expect(knee).toBeLessThan(120)
  })

  it('step-up: while the trailing foot is in the air the centre of mass stays over the box foot, fore-aft and sideways', () => {
    const b = get(410)
    const f0 = fk(skel, frameQ(b, 0))
    let air = 0
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const caps = bodyCapsules(skel, f).filter((c) => c.region === 'foot_l')
      const onBox = Math.abs(sitePos(skel, f, 'heel_l')[1] - sitePos(skel, f0, 'heel_l')[1]) < 0.005
      const lifted = Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r)) > 0.01 && !onBox
      if (!lifted) continue
      air++
      const loads = ['l', 'r'].map((s) => ({ mass: 16, pos: sitePos(skel, f, `grip_${s}`) }))
      const com = centerOfMass(skel, f, loads)
      const heel = sitePos(skel, f, 'heel_r'), ball = sitePos(skel, f, 'ball_r')
      expect(com[2], `@${i} fore-aft`).toBeGreaterThan(heel[2])
      expect(com[2], `@${i} fore-aft`).toBeLessThan(ball[2])
      // over the box foot's width (foot capsules about 96 mm wide)
      expect(Math.abs(com[0] - (heel[0] + ball[0]) / 2), `@${i} sideways`).toBeLessThan(0.045)
    }
    expect(air).toBeGreaterThan(20)
  })

  it('split squat on the floor: the rear ball stays planted, front knee ~5-20 -> 90-100, the rear knee drops to the floor', () => {
    for (const id of [423, 430]) {
      const b = get(id)
      expect(b.contacts.map((c) => c.site)).toContain('ball_l')
      // standing tall in the split stance leaves a little bend in the front knee (Smith: the rail line puts both legs long)
      expect(dof(b, 0, 'knee_r.flex'), `${id} top`).toBeLessThan(id === 423 ? 10 : 16)
      expect(dof(b, 0, 'knee_l.flex'), `${id} rear top`).toBeLessThan(8)
      const knee = dof(b, bottomU(b), 'knee_r.flex')
      // the Smith's long stance: the rear knee reaches the floor with the front shin near vertical, a little short of 90
      expect(knee, `${id} bottom`).toBeGreaterThan(id === 423 ? 80 : 90)
      expect(knee, `${id} bottom`).toBeLessThan(101)
      expect(dof(b, bottomU(b), 'knee_l.flex'), `${id} rear bottom`).toBeGreaterThan(85)
      const caps = bodyCapsules(skel, fk(skel, frameQ(b, at(b, bottomU(b))))).filter((c) => /^(thigh|shank)_l$/.test(c.region))
      const low = Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r))
      expect(low, `${id} rear knee near the floor`).toBeGreaterThan(0.02)
      expect(low, `${id} rear knee near the floor`).toBeLessThan(0.12)
      // the heel stays up, higher at the bottom
      const f = fk(skel, frameQ(b, at(b, bottomU(b))))
      expect(sitePos(skel, f, 'heel_l')[1] - sitePos(skel, f, 'ball_l')[1]).toBeGreaterThan(0.08)
      // Smith: the back knee drops about straight down under the hips
      if (id === 423) {
        const hip = (segPos(skel, f, 'femur_l')[2] + segPos(skel, f, 'femur_r')[2]) / 2
        expect(Math.abs(segPos(skel, f, 'tibia_l')[2] - hip), 'rear knee under the hips').toBeLessThan(0.07)
      }
    }
  })

  it('bar on the back: it rides on the upper back, the hands hold it; on the Smith it stays on the rail line', () => {
    for (const id of [423, 424]) {
      const b = get(id)
      const k = b.implements.findIndex((s) => s.id === 'bar')
      for (let i = 0; i < b.frames; i += 5) {
        const f = fk(skel, frameQ(b, i))
        const bar = frameImplements(b, i)[k].pos
        // behind the neck, above the shoulder joints
        expect(bar[1], `${id} @${i}`).toBeGreaterThan(segPos(skel, f, 'humerus_l')[1])
        expect(bar[2], `${id} @${i}`).toBeLessThan(segPos(skel, f, 'neck1')[2])
      }
    }
    const smith = get(423)
    const k = smith.implements.findIndex((s) => s.id === 'bar')
    const z0 = frameImplements(smith, 0)[k].pos[2]
    for (let i = 0; i < smith.frames; i++) expect(Math.abs(frameImplements(smith, i)[k].pos[2] - z0)).toBeLessThan(0.001)
    expect(smith.implements.some((s) => s.id === 'smith')).toBe(true)
  })

  it.each([
    ['barbell forward lunge', { implement: 'barbell', hold: 'back_high', direction: 'forward' }],
    ['Smith reverse lunge', { implement: 'smith', hold: 'back_high', direction: 'reverse' }],
    ['barbell split squat with the rear foot on a bench', { implement: 'barbell', hold: 'back_high', direction: 'in_place', rearFootElevated: true }],
    ['goblet hold', { hold: 'goblet' }],
    ['left working side', { side: 'left' }],
  ])('%s: throws variant not implemented yet', (_, params) => {
    expect(() => getTemplate('lunge').setup(parseParams('lunge', params), skel)).toThrow(/variant not implemented yet/)
  })

  // ---------- wave 3b ----------

  it('lateral lunge (426): wide stance, both feet flat throughout; the hips sit back over the right foot, the left leg near straight', () => {
    const b = get(426)
    const u = bottomU(b)
    expect(b.contacts.filter((c) => c.kind === 'planted')).toHaveLength(4)
    const f = fk(skel, frameQ(b, at(b, u)))
    const f0 = fk(skel, frameQ(b, 0))
    const rightX = sitePos(skel, f, 'midfoot_r')[0], leftX = sitePos(skel, f, 'midfoot_l')[0]
    expect(leftX - rightX).toBeGreaterThan(0.65)
    expect(segPos(skel, f0, 'pelvis')[0]).toBeCloseTo(0, 2)
    // hips well over towards the right foot, lower and further back than standing
    expect(segPos(skel, f, 'pelvis')[0]).toBeLessThan((leftX + rightX) / 2 - 0.25 * (leftX - rightX))
    expect(dof(b, u, 'knee_r.flex')).toBeGreaterThan(65)
    expect(dof(b, u, 'knee_l.flex')).toBeLessThan(7)
    expect(trunkLean(b, u)).toBeGreaterThan(20)
  })

  it('curtsy lunge (433): the left foot lands on its ball behind and across the right foot', () => {
    const b = get(433)
    const f = fk(skel, frameQ(b, at(b, bottomU(b))))
    expect(sitePos(skel, f, 'ball_l')[0]).toBeLessThan(sitePos(skel, f, 'midfoot_r')[0] - 0.05)
    expect(sitePos(skel, f, 'ball_l')[2]).toBeLessThan(sitePos(skel, f, 'heel_r')[2] - 0.3)
    expect(sitePos(skel, f, 'heel_l')[1]).toBeGreaterThan(0.05)
    expect(dof(b, bottomU(b), 'knee_r.flex')).toBeGreaterThan(85)
  })

  it('goblet kettlebell reverse lunge (431): the bell upright at the chest, the hands on the horns', () => {
    const b = get(431)
    const k = b.implements.findIndex((s) => s.kind === 'kettlebell')
    expect(b.contacts.filter((c) => c.kind === 'grip').map((c) => (c.target as { grip: string }).grip).sort()).toEqual(['horn_l', 'horn_r'])
    for (let i = 0; i < b.frames; i += 9) {
      const f = fk(skel, frameQ(b, i))
      const pose = frameImplements(b, i)[k]
      expect(Math.abs(pose.pos[1] - localToWorld(skel, f, 'thorax2', skel.data.sites.sternum.local)[1])).toBeLessThan(0.08)
    }
  })

  it('front-foot-elevated split squat (434): the front foot flat on a low step, the back knee drops below the step', () => {
    const b = get(434)
    const k = b.implements.findIndex((s) => s.id === 'step')
    const top = siteWorld(b.implements[k], frameImplements(b, 0)[k], 'top').pos[1]
    expect(top).toBeCloseTo(0.1, 3)
    const f = fk(skel, frameQ(b, at(b, bottomU(b))))
    expect(sitePos(skel, f, 'heel_r')[1]).toBeCloseTo(top, 3)
    const knee = Math.min(...bodyCapsules(skel, f).filter((c) => /^(thigh|shank)_l$/.test(c.region)).map((c) => Math.min(c.a[1], c.b[1]) - c.r))
    expect(knee).toBeLessThan(top)
  })

  it('cossack squat (427): the hips sink over the right foot as deep as its heel stays down, the left leg straight, its toes up', () => {
    const b = get(427)
    const u = bottomU(b)
    // the right ankle stops at ~38 deg of dorsiflexion (heel down); the knee bends ~75-90
    expect(dof(b, u, 'ankle_r.df')).toBeGreaterThan(36)
    expect(dof(b, u, 'ankle_r.df')).toBeLessThan(38.6)
    expect(dof(b, u, 'knee_r.flex')).toBeGreaterThan(72)
    for (let i = 0; i < b.frames; i++) expect(frameQ(b, i)[skel.dof['knee_l.flex']]).toBeLessThan(6.5)
    const f0 = fk(skel, frameQ(b, 0)), fb = fk(skel, frameQ(b, at(b, u)))
    // the hips move over the right foot; the left heel stays put while its toes rise ~45 deg
    expect(segPos(skel, fb, 'pelvis')[0]).toBeLessThan(segPos(skel, f0, 'pelvis')[0] - 0.25)
    expect(dist(sitePos(skel, fb, 'heel_l'), sitePos(skel, f0, 'heel_l'))).toBeLessThan(0.002)
    expect(sitePos(skel, fb, 'toe_l')[1] - sitePos(skel, f0, 'toe_l')[1]).toBeGreaterThan(0.12)
    // the right foot stays flat
    expect(Math.abs(sitePos(skel, fb, 'heel_r')[1] - sitePos(skel, fb, 'ball_r')[1])).toBeLessThan(0.002)
  })

  it.each([
    ['cossack squat with dumbbells', { implement: 'dumbbell', hold: 'goblet', direction: 'cossack' }],
    ['lateral lunge with the dumbbells at the sides', { hold: 'sides', direction: 'lateral' }],
    ['curtsy with a bar', { implement: 'barbell', hold: 'back_high', direction: 'curtsy' }],
    ['front foot elevated on a step-up', { direction: 'step_up', frontFootElevated: true }],
  ])('%s: throws variant not implemented yet (3b)', (_, params) => {
    expect(() => getTemplate('lunge').setup(parseParams('lunge', params), skel)).toThrow(/variant not implemented yet/)
  })
})

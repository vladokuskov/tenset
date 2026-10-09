import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { contactError, frameAt, seamRatio } from './core/checks.ts'
import { MAT_TOP } from './core/floor.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('floor-core')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('floor-core'), parseParams('floor-core', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const dof = (b: Baked, i: number, name: string) => frameQ(b, i)[skel.dof[name]]
const TOP = 0, BOTTOM = 0.625
/** thigh elevation above level, deg (+ up towards the feet end for a supine body) */
function thighElev(b: Baked, i: number, s: 'l' | 'r') {
  const f = fk(skel, frameQ(b, i))
  const hip = segPos(skel, f, `femur_${s}`), knee = segPos(skel, f, `tibia_${s}`)
  return (Math.atan2(knee[1] - hip[1], Math.hypot(knee[0] - hip[0], knee[2] - hip[2])) * 180) / Math.PI
}
const lowest = (b: Baked, i: number, pick: (region: string) => boolean) =>
  Math.min(...bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => pick(c.region)).map((c) => Math.min(c.a[1], c.b[1]) - c.r))

describe('floor-core template', () => {
  it('covers every family record', () => {
    expect([...baked.keys()].sort()).toEqual([813, 814, 816, 820, 837, 839, 842])
  })

  it.each([813, 814, 816, 820, 837, 839, 842])('%s: contacts held, the loop closes, nothing sinks through the floor', (id) => {
    const b = get(id)
    for (let i = 0; i < b.frames; i++) {
      expect(contactError(skel, b, i)).toBeLessThan(0.005)
      // flat palms and tucked toes sink into the mat by the plank allowance (core/hand-plank.ts)
      expect(lowest(b, i, () => true)).toBeGreaterThan(-0.07)
    }
    expect(seamRatio(skel, b)).toBeLessThan(1.5)
  })

  it('unsupported variants throw', () => {
    expect(() => bake(getTemplate('floor-core'), parseParams('floor-core', { kind: 'dragon_flag' }, 'bilateral'), skel)).toThrow(/variant not implemented/)
  })

  it('813 dead bug: tabletop at the top, the right arm overhead and the left leg long just off the mat at the bottom', () => {
    const b = get(813)
    expect(thighElev(b, frameAt(b, TOP), 'l')).toBeGreaterThan(75)
    expect(dof(b, frameAt(b, TOP), 'knee_l.flex')).toBeGreaterThan(80)
    const bottom = frameAt(b, BOTTOM)
    expect(thighElev(b, bottom, 'l')).toBeLessThan(20)
    expect(dof(b, bottom, 'knee_l.flex')).toBeLessThan(10)
    expect(dof(b, bottom, 'shoulder_r.elev')).toBeGreaterThan(160)
    expect(dof(b, bottom, 'shoulder_l.elev')).toBeLessThan(100)
    // the other leg stays in the tabletop
    expect(thighElev(b, bottom, 'r')).toBeGreaterThan(75)
    expect(lowest(b, bottom, (r) => r.startsWith('foot_l'))).toBeGreaterThan(MAT_TOP)
  })

  it('814 bird dog: the right arm reaches forward and the left leg back to about level, the other knee and hand down', () => {
    const b = get(814)
    const f = fk(skel, frameQ(b, frameAt(b, TOP)))
    const sh = segPos(skel, f, 'humerus_r'), hand = sitePos(skel, f, 'grip_r')
    expect(hand[2] - sh[2]).toBeGreaterThan(0.45)
    expect(Math.abs(hand[1] - sh[1])).toBeLessThan(0.15)
    const hip = segPos(skel, f, 'femur_l'), ankle = segPos(skel, f, 'foot_l')
    expect(hip[2] - ankle[2]).toBeGreaterThan(0.6)
    expect(Math.abs(ankle[1] - hip[1])).toBeLessThan(0.15)
    expect(segPos(skel, f, 'tibia_r')[1]).toBeLessThan(0.1)
    // hips level
    expect(Math.abs(segPos(skel, f, 'femur_l')[1] - segPos(skel, f, 'femur_r')[1])).toBeLessThan(0.02)
  })

  it('816 mountain climber: the right knee comes in under the chest, the left foot stays planted', () => {
    const b = get(816)
    const top = fk(skel, frameQ(b, frameAt(b, TOP))), bottom = fk(skel, frameQ(b, frameAt(b, BOTTOM)))
    expect(segPos(skel, top, 'tibia_r')[2] - segPos(skel, top, 'femur_r')[2]).toBeGreaterThan(0.15)
    expect(segPos(skel, bottom, 'femur_r')[2] - segPos(skel, bottom, 'tibia_r')[2]).toBeGreaterThan(0.3)
    expect(lowest(b, frameAt(b, TOP), (r) => r === 'foot_r')).toBeGreaterThan(MAT_TOP)
  })

  it('820 bicycle: shoulders off the mat, the trunk turns from one side to the other as the knees swap', () => {
    const b = get(820)
    const top = frameAt(b, TOP), bottom = frameAt(b, BOTTOM)
    expect(dof(b, top, 'thorax.rot')).toBeGreaterThan(10)
    expect(dof(b, bottom, 'thorax.rot')).toBeLessThan(-10)
    expect(thighElev(b, top, 'l') - thighElev(b, top, 'r')).toBeGreaterThan(30)
    expect(thighElev(b, bottom, 'r') - thighElev(b, bottom, 'l')).toBeGreaterThan(30)
    expect(lowest(b, top, (r) => r === 'head')).toBeGreaterThan(MAT_TOP + 0.05)
  })

  it('837 V-up: long and low at the bottom, folded on the seat at the top with the hands towards the shins', () => {
    const b = get(837)
    const bottom = frameAt(b, BOTTOM), top = frameAt(b, TOP)
    expect(thighElev(b, bottom, 'l')).toBeLessThan(15)
    expect(dof(b, bottom, 'shoulder_l.elev')).toBeGreaterThan(160)
    expect(thighElev(b, top, 'l')).toBeGreaterThan(50)
    expect(dof(b, top, 'hip_l.flex')).toBeGreaterThan(80)
    const f = fk(skel, frameQ(b, top))
    expect(sitePos(skel, f, 'grip_l')[1]).toBeGreaterThan(segPos(skel, f, 'humerus_l')[1] - 0.1)
  })

  it('839 dragon flag: one line from the shoulders to the feet, pivoting on the upper back, hands on the bench', () => {
    const b = get(839)
    for (const i of [frameAt(b, TOP), frameAt(b, BOTTOM)]) {
      expect(Math.abs(dof(b, i, 'hip_l.flex'))).toBeLessThan(3)
      expect(Math.abs(dof(b, i, 'lumbar.flex'))).toBeLessThan(3)
    }
    const f = (i: number) => fk(skel, frameQ(b, i))
    const angle = (i: number) => {
      const sh = segPos(skel, f(i), 'humerus_l'), ankle = segPos(skel, f(i), 'foot_l')
      return (Math.atan2(ankle[1] - sh[1], ankle[2] - sh[2]) * 180) / Math.PI
    }
    expect(angle(frameAt(b, BOTTOM))).toBeLessThan(20)
    expect(angle(frameAt(b, TOP))).toBeGreaterThan(45)
    const k = b.implements.findIndex((s) => s.kind === 'bench')
    expect(frameImplements(b, 0)[k].pos[1]).toBeCloseTo(0.43, 3)
  })

  it('842 superman: a breathing hold on the belly, chest, arms and legs off the mat', () => {
    const b = get(842)
    for (let i = 0; i < b.frames; i++) {
      expect(lowest(b, i, (r) => r.startsWith('hand_'))).toBeGreaterThan(MAT_TOP + 0.03)
      expect(lowest(b, i, (r) => r.startsWith('foot_'))).toBeGreaterThan(MAT_TOP + 0.03)
      expect(dof(b, i, 'lumbar.flex')).toBeLessThan(-10)
    }
  })
})

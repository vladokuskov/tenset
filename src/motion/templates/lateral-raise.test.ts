import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { handFrame } from '../constraints.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import { shoulderRhythm } from '../skeleton.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('lateral-raise')
const baked = new Map(variants.map((v) => [v.slug, bake(getTemplate('lateral-raise'), parseParams('lateral-raise', v.params, v.laterality), skel)]))
const get = (slug: string) => baked.get(slug)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]

describe('lateral-raise template', () => {
  it('dumbbell: scapular plane, ~10 -> 85 deg elevation, fixed soft elbow, girdle follows the rhythm', () => {
    const b = get('203-dumbbell-lateral-raise')
    expect(dof(b, 0.3, 'shoulder_l.plane')).toBeCloseTo(20, 5)
    expect(dof(b, 0.625, 'shoulder_l.elev')).toBeCloseTo(10, 5)
    expect(dof(b, 0, 'shoulder_l.elev')).toBeCloseTo(85, 5)
    expect(dof(b, 0.3, 'elbow_l.flex')).toBeCloseTo(15, 5)
    expect(dof(b, 0.625, 'clavicle_l.elev')).toBeLessThan(0.5)
    expect(dof(b, 0, 'clavicle_l.elev')).toBeGreaterThan(2)
    // scapular upward rotation (shoulder01) carries most of the girdle motion
    expect(dof(b, 0.625, 'scapula_l.uprot')).toBeLessThan(0.5)
    expect(dof(b, 0, 'scapula_l.uprot')).toBeCloseTo(shoulderRhythm(85, 20).uprot, 3)
    expect(dof(b, 0, 'scapula_l.uprot')).toBeGreaterThan(dof(b, 0, 'clavicle_l.elev'))
  })

  it.each([...baked.keys()])('%s: loads stay in the hands', (slug) => {
    const b = get(slug)
    for (let i = 0; i < b.frames; i += 4) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind !== 'grip' || !('implement' in c.target)) continue
        const { implement, grip } = c.target
        const k = b.implements.findIndex((s) => s.id === implement)
        expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], grip).pos)).toBeLessThan(0.005)
      }
    }
  })

  it('unilateral variants move only the working arm', () => {
    for (const slug of ['204-cable-lateral-raise', '214-lean-away-lateral-raise']) {
      const b = get(slug)
      expect(dof(b, 0, 'shoulder_r.elev') - dof(b, 0.625, 'shoulder_r.elev')).toBeGreaterThan(60)
      expect(Math.abs(dof(b, 0, 'shoulder_l.elev') - dof(b, 0.625, 'shoulder_l.elev'))).toBeLessThan(5)
    }
  })

  it('the body does not rock with the arms, and the cable start leaves for the scapular plane early', () => {
    const b = get('203-dumbbell-lateral-raise')
    const z = Array.from({ length: b.frames }, (_, i) => frameQ(b, i)[skel.dof['pelvis.tz']])
    expect(Math.max(...z) - Math.min(...z)).toBeLessThan(0.02)
    const cable = get('204-cable-lateral-raise')
    // mid concentric: the arm is already near the working plane, not raised forward
    expect(dof(cable, 0.83, 'shoulder_r.plane')).toBeLessThan(40)
  })

  it('lean-away: the supporting arm is nearly straight', () => {
    const b = get('214-lean-away-lateral-raise')
    for (let i = 0; i < b.frames; i += 4) expect(frameQ(b, i)[skel.dof['elbow_l.flex']]).toBeLessThan(20)
  })

  it('lean-away: the body tilts away from the upright and the dumbbell hangs under the shoulder at the bottom', () => {
    const b = get('214-lean-away-lateral-raise')
    const f = fk(skel, frameQ(b, at(b, 0.625)))
    const neck = segPos(skel, f, 'neck1')
    const pelvis = segPos(skel, f, 'pelvis')
    const tilt = (Math.atan2(pelvis[0] - neck[0], neck[1] - pelvis[1]) * 180) / Math.PI
    expect(tilt).toBeGreaterThan(12)
    const gh = segPos(skel, f, 'humerus_r')
    const hand = handFrame(skel, f, 'r').pos
    expect(Math.abs(hand[0] - gh[0])).toBeLessThan(0.08)
  })
})

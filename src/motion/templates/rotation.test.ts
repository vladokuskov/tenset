import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, dot, qrot } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { contactError, frameAt, seamRatio } from './core/checks.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('rotation')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('rotation'), parseParams('rotation', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const dof = (b: Baked, i: number, name: string) => frameQ(b, i)[skel.dof[name]]
const START = 0.625, FINISH = 0
/** shoulder-line turn from facing front, deg (+ left): pelvis yaw plus lumbar and thoracic rotation */
const turn = (b: Baked, i: number) => dof(b, i, 'pelvis.rot') + dof(b, i, 'lumbar.rot') + dof(b, i, 'thorax.rot')

function handleCenter(b: Baked, i: number) {
  const k = b.implements.findIndex((s) => s.id === 'handle')
  const pose = frameImplements(b, i)[k]
  const l = siteWorld(b.implements[k], pose, 'l').pos, r = siteWorld(b.implements[k], pose, 'r').pos
  return [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2]
}

describe('rotation template', () => {
  it('covers every family record', () => {
    expect([...baked.keys()]).toEqual([809])
  })

  it('809 woodchop: contacts held, loop closes, arms long', () => {
    const b = get(809)
    for (let i = 0; i < b.frames; i++) {
      expect(contactError(skel, b, i)).toBeLessThan(0.005)
      expect(Math.min(dof(b, i, 'elbow_l.flex'), dof(b, i, 'elbow_r.flex'))).toBeLessThan(18)
    }
    expect(seamRatio(skel, b)).toBeLessThan(1.5)
  })

  it('809 woodchop: hips and torso turn together from the stack to the far side', () => {
    const b = get(809)
    const s = frameAt(b, START), f = frameAt(b, FINISH)
    // research (motion-authoring): trunk rotation +-30-45 deg; the chop turns the whole shoulder line past that
    expect(turn(b, f) - turn(b, s)).toBeGreaterThan(90)
    expect((dof(b, f, 'pelvis.rot') - dof(b, s, 'pelvis.rot')) / (turn(b, f) - turn(b, s))).toBeGreaterThan(0.4)
    // weight shifts onto the far (left) leg: the hip midpoint travels towards it
    const hips = (i: number) => {
      const g = fk(skel, frameQ(b, i))
      return (segPos(skel, g, 'femur_l')[0] + segPos(skel, g, 'femur_r')[0]) / 2
    }
    expect(hips(f) - hips(s)).toBeGreaterThan(0.08)
  })

  it('809 woodchop: high by the pulley to low outside the far hip (the cue), the near heel pivots up', () => {
    const b = get(809)
    const s = frameAt(b, START), f = frameAt(b, FINISH)
    const fs = fk(skel, frameQ(b, s)), ff = fk(skel, frameQ(b, f))
    expect(handleCenter(b, s)[1]).toBeGreaterThan(segPos(skel, fs, 'humerus_r')[1] + 0.2)
    expect(handleCenter(b, s)[0]).toBeLessThan(-0.3)
    const knee = segPos(skel, ff, 'tibia_l'), hip = segPos(skel, ff, 'femur_l')
    expect(handleCenter(b, f)[1]).toBeLessThan(hip[1])
    expect(handleCenter(b, f)[1]).toBeGreaterThan(knee[1])
    expect(handleCenter(b, f)[0]).toBeGreaterThan(hip[0] + 0.2)
    expect(sitePos(skel, ff, 'heel_r')[1] - sitePos(skel, fs, 'heel_r')[1]).toBeGreaterThan(0.03)
  })

  it('809 woodchop: the near foot pivots on its ball, toes flat and heel up, the ball does not slide', () => {
    const b = get(809)
    const s = frameAt(b, START), f = frameAt(b, FINISH)
    const ball0 = sitePos(skel, fk(skel, frameQ(b, s)), 'ball_r')
    for (let i = 0; i < b.frames; i++) {
      const g = fk(skel, frameQ(b, i))
      expect(dist(sitePos(skel, g, 'ball_r'), ball0)).toBeLessThan(0.003)
      // the turned-under toes lie on the floor (the toe segment's long axis stays horizontal)
      expect(Math.abs(qrot(g.rot[skel.seg.toes_r], [0, 0, 1])[1])).toBeLessThan(0.02)
    }
    expect(sitePos(skel, fk(skel, frameQ(b, f)), 'heel_r')[1]).toBeGreaterThan(0.04)
  })

  it('809 woodchop: the bar sits square in both fists (no slide across a palm), the bent arm stays long', () => {
    const b = get(809)
    const k = b.implements.findIndex((x) => x.id === 'handle')
    for (let i = 0; i < b.frames; i++) {
      const g = fk(skel, frameQ(b, i))
      const pose = frameImplements(b, i)[k]
      for (const side of ['l', 'r'] as const) {
        const bar = siteWorld(b.implements[k], pose, side).axis!
        const hand = qrot(g.rot[skel.seg[`hand_${side}`]], skel.data.sites[`grip_${side}`].axis!)
        // the composer closes one wrap over the loop: a bar turning in the palm leaves the fingers open under it
        expect((Math.acos(Math.min(1, Math.abs(dot(bar, hand)))) * 180) / Math.PI).toBeLessThan(3)
      }
      expect(Math.max(dof(b, i, 'elbow_l.flex'), dof(b, i, 'elbow_r.flex'))).toBeLessThan(28)
    }
  })

  it('unsupported variants say so', () => {
    const t = getTemplate('rotation')
    expect(() => t.setup(parseParams('rotation', { direction: 'low_to_high' }), skel)).toThrow(/variant not implemented yet/)
  })
})

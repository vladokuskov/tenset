import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
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

  it('809 woodchop: high by the pulley to low outside the far knee, the near heel pivots up', () => {
    const b = get(809)
    const s = frameAt(b, START), f = frameAt(b, FINISH)
    const fs = fk(skel, frameQ(b, s)), ff = fk(skel, frameQ(b, f))
    expect(handleCenter(b, s)[1]).toBeGreaterThan(segPos(skel, fs, 'humerus_r')[1] + 0.2)
    expect(handleCenter(b, s)[0]).toBeLessThan(-0.3)
    const knee = segPos(skel, ff, 'tibia_l')
    expect(handleCenter(b, f)[1]).toBeLessThan(knee[1] + 0.45)
    expect(handleCenter(b, f)[0]).toBeGreaterThan(knee[0])
    expect(sitePos(skel, ff, 'heel_r')[1] - sitePos(skel, fs, 'heel_r')[1]).toBeGreaterThan(0.03)
  })

  it('unsupported variants say so', () => {
    const t = getTemplate('rotation')
    expect(() => t.setup(parseParams('rotation', { direction: 'low_to_high' }), skel)).toThrow(/variant not implemented yet/)
  })
})

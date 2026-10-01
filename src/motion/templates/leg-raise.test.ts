import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules } from '../collide.ts'
import { centerOfMass, fk, segPos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { FLOOR_MAT } from '../implements/shared.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { contactError, frameAt, seamRatio } from './core/checks.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('leg-raise')
const params = new Map(variants.map((v) => [v.id, parseParams('leg-raise', v.params, v.laterality)]))
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('leg-raise'), params.get(v.id)!, skel)]))
const get = (id: number) => baked.get(id)!
const dof = (b: Baked, i: number, name: string) => frameQ(b, i)[skel.dof[name]]
const TOP = 0, BOTTOM = 0.625
/** flexion between thighs and thorax: hip plus lumbar and thoracic flexion */
const total = (b: Baked, i: number) => dof(b, i, 'hip_l.flex') + dof(b, i, 'lumbar.flex') + dof(b, i, 'thorax.flex')

describe('leg-raise template', () => {
  it('covers every family record', () => {
    expect([...baked.keys()].sort()).toEqual([802, 806, 807])
  })

  it.each([802, 806, 807])('%s: contacts held, loop closes, hips flex to the param with the pelvis curling up', (id) => {
    const b = get(id)
    const p = params.get(id)!
    for (let i = 0; i < b.frames; i++) expect(contactError(skel, b, i)).toBeLessThan(0.005)
    expect(seamRatio(skel, b)).toBeLessThan(1.5)
    const top = frameAt(b, TOP), bottom = frameAt(b, BOTTOM)
    const topHip = p.topHipAngle as number
    // research (motion-authoring): hip 0 -> 90-110 deg
    if (p.posture === 'hanging') expect(total(b, top)).toBeCloseTo(topHip, 0)
    // posterior pelvic tilt at the top
    expect(dof(b, bottom, 'pelvis.tilt') - dof(b, top, 'pelvis.tilt')).toBeGreaterThan(8)
    const knee = p.kneeAngle as number
    expect(dof(b, top, 'knee_l.flex')).toBeCloseTo(Math.max(3, knee), 0)
  })

  it.each([802, 806])('%s: hanging still, centre of mass under the grips, toes off the floor', (id) => {
    const b = get(id)
    const k = b.implements.findIndex((s) => s.kind === 'pullup_bar')
    let zLo = Infinity, zHi = -Infinity
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const pose = frameImplements(b, i)[k]
      const barZ = (siteWorld(b.implements[k], pose, 'l').pos[2] + siteWorld(b.implements[k], pose, 'r').pos[2]) / 2
      expect(Math.abs(centerOfMass(skel, f)[2] - barZ)).toBeLessThan(0.015)
      for (const c of bodyCapsules(skel, f)) expect(Math.min(c.a[1], c.b[1]) - c.r).toBeGreaterThan(0.05)
      expect(dof(b, i, 'elbow_l.flex')).toBeLessThan(10)
      const z = segPos(skel, f, 'thorax2')[2]
      zLo = Math.min(zLo, z)
      zHi = Math.max(zHi, z)
    }
    // the chest moves back only as far as the legs' weight needs, no swing
    expect(zHi - zLo).toBeLessThan(0.2)
  })

  it('802: straight legs together (the cue), ankles and knees close all through the rep', () => {
    const b = get(802)
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      // centre to centre; the ankles are ~7 cm wide, so ~10 cm apart reads as legs together
      expect(segPos(skel, f, 'foot_l')[0] - segPos(skel, f, 'foot_r')[0]).toBeLessThan(0.12)
      expect(segPos(skel, f, 'tibia_l')[0] - segPos(skel, f, 'tibia_r')[0]).toBeLessThan(0.18)
    }
  })

  it('807 lying: legs from just off the mat to vertical, lower back pressed down', () => {
    const b = get(807)
    const top = frameAt(b, TOP), bottom = frameAt(b, BOTTOM)
    const elev = (i: number) => {
      const f = fk(skel, frameQ(b, i))
      const hip = segPos(skel, f, 'femur_l'), knee = segPos(skel, f, 'tibia_l')
      return (Math.atan2(knee[1] - hip[1], Math.abs(knee[2] - hip[2])) * 180) / Math.PI
    }
    expect(elev(bottom)).toBeGreaterThan(8)
    expect(elev(bottom)).toBeLessThan(22)
    expect(elev(top)).toBeGreaterThan(84)
    for (let i = 0; i < b.frames; i++) {
      const trunk = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.segment === 'pelvis' || c.segment.startsWith('thorax'))
      const low = Math.min(...trunk.map((c) => Math.min(c.a[1], c.b[1]) - c.r))
      expect(low).toBeLessThan(FLOOR_MAT.thick)
      expect(low).toBeGreaterThan(-0.005)
    }
  })

  it('unsupported variants say so', () => {
    const t = getTemplate('leg-raise')
    expect(() => t.setup(parseParams('leg-raise', { posture: 'hanging', support: 'elbow_pads' }), skel)).toThrow(/variant not implemented yet/)
  })
})

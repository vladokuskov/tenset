import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules } from '../collide.ts'
import { centerOfMass, fk, segPos, sitePos } from '../fk.ts'
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
    expect([...baked.keys()].sort()).toEqual([802, 806, 807, 819, 825, 826, 827, 836])
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
    // the captain's chair (elbow pads) has no toes-to-bar or lying variant
    expect(() => t.setup(parseParams('leg-raise', { posture: 'lying_supine', support: 'elbow_pads' }), skel)).toThrow(/variant not implemented yet/)
  })

  it.each([819, 825, 827])('%s: contacts held, the loop closes', (id) => {
    const b = get(id)
    for (let i = 0; i < b.frames; i++) expect(contactError(skel, b, i)).toBeLessThan(0.005)
    expect(seamRatio(skel, b)).toBeLessThan(1.5)
  })

  it('827 toes-to-bar: the trunk lies back and the toes reach the bar between the hands, the centre of mass under the grips', () => {
    const b = get(827)
    const top = frameAt(b, TOP), bottom = frameAt(b, BOTTOM)
    const bar = frameImplements(b, top)[0].pos
    const f = fk(skel, frameQ(b, top))
    for (const s of ['l', 'r']) {
      const toe = sitePos(skel, f, `toe_${s}`)
      expect(bar[1] - toe[1]).toBeGreaterThan(0.02)
      expect(bar[1] - toe[1]).toBeLessThan(0.07)
      expect(Math.abs(toe[2] - bar[2])).toBeLessThan(0.1)
      expect(Math.abs(toe[0])).toBeLessThan(skel.data.shoulderWidth * 0.675)
    }
    expect(dof(b, top, 'pelvis.tilt')).toBeLessThan(-40)
    expect(total(b, top) - total(b, bottom)).toBeGreaterThan(130)
    for (let i = 0; i < b.frames; i++) expect(Math.abs(centerOfMass(skel, fk(skel, frameQ(b, i)))[2] - bar[2])).toBeLessThan(0.02)
  })

  it('819 reverse crunch: the knees hold 90, the hips roll up off the mat while the upper back stays down', () => {
    const b = get(819)
    const top = frameAt(b, TOP), bottom = frameAt(b, BOTTOM)
    const ft = fk(skel, frameQ(b, top)), fb = fk(skel, frameQ(b, bottom))
    expect(segPos(skel, ft, 'femur_l')[1] - segPos(skel, fb, 'femur_l')[1]).toBeGreaterThan(0.03)
    expect(Math.abs(segPos(skel, ft, 'thorax2')[1] - segPos(skel, fb, 'thorax2')[1])).toBeLessThan(0.015)
    expect(dof(b, bottom, 'pelvis.tilt') - dof(b, top, 'pelvis.tilt')).toBeGreaterThan(30)
    for (let i = 0; i < b.frames; i++) expect(dof(b, i, 'knee_l.flex')).toBeCloseTo(90, 0)
  })

  it('825 oblique knee raise: the knees rise towards the right shoulder, the centre of mass stays between the hands', () => {
    const b = get(825)
    const top = frameAt(b, TOP), bottom = frameAt(b, BOTTOM)
    const ft = fk(skel, frameQ(b, top)), fb = fk(skel, frameQ(b, bottom))
    const knees = (f: ReturnType<typeof fk>) => (segPos(skel, f, 'tibia_l')[0] + segPos(skel, f, 'tibia_r')[0]) / 2 - segPos(skel, f, 'pelvis')[0]
    expect(knees(ft) - knees(fb)).toBeLessThan(-0.1)
    expect(dof(b, top, 'pelvis.rot')).toBeLessThan(-20)
    // the shoulders stay nearly square under the bar while the hips turn: the spine turns back what the pelvis turns
    // (measured on the joint lines, which the whole body's roll about the forward axis leaves alone)
    const yaw = (seg: string) => {
      const l = segPos(skel, ft, `${seg}_l`), r = segPos(skel, ft, `${seg}_r`)
      return Math.abs((Math.atan2(l[2] - r[2], l[0] - r[0]) * 180) / Math.PI)
    }
    expect(yaw('femur')).toBeGreaterThan(40)
    expect(yaw('humerus')).toBeLessThan(8)
    for (let i = 0; i < b.frames; i++) expect(Math.abs(centerOfMass(skel, fk(skel, frameQ(b, i)))[0])).toBeLessThan(0.02)
  })

  it('825 oblique knee raise: both arms stay straight (the body swings and rolls under the bar instead)', () => {
    const b = get(825)
    for (let i = 0; i < b.frames; i++) for (const s of ['l', 'r']) expect(dof(b, i, `elbow_${s}.flex`)).toBeLessThan(10)
  })

  it('826 captain\'s chair: hands on the handles, elbows on the pads, knees above the hips at the top, legs hanging at the bottom', () => {
    const b = get(826)
    for (let i = 0; i < b.frames; i++) expect(contactError(skel, b, i)).toBeLessThan(0.005)
    const k = b.implements.findIndex((s) => s.kind === 'captains_chair')
    const pad = siteWorld(b.implements[k], frameImplements(b, 0)[k], 'forearm_l').pos
    const f = fk(skel, frameQ(b, frameAt(b, TOP)))
    expect(Math.abs(segPos(skel, f, 'forearm_l')[1] - pad[1])).toBeLessThan(0.06)
    expect(segPos(skel, f, 'tibia_l')[1]).toBeGreaterThan(segPos(skel, f, 'femur_l')[1])
    expect(dof(b, frameAt(b, TOP), 'knee_l.flex')).toBeGreaterThan(80)
    expect(total(b, frameAt(b, BOTTOM))).toBeLessThan(15)
    // the pelvis curls up at the top
    expect(dof(b, frameAt(b, TOP), 'lumbar.flex')).toBeGreaterThan(12)
  })

  it('836 flutter kick: straight legs scissor in opposite directions, the lower back stays down', () => {
    const b = get(836)
    const top = frameAt(b, TOP), bottom = frameAt(b, BOTTOM)
    for (const i of [top, bottom]) expect(dof(b, i, 'knee_l.flex')).toBeLessThan(6)
    expect(dof(b, top, 'hip_r.flex') - dof(b, top, 'hip_l.flex')).toBeGreaterThan(14)
    expect(dof(b, bottom, 'hip_l.flex') - dof(b, bottom, 'hip_r.flex')).toBeGreaterThan(14)
    expect(dof(b, top, 'pelvis.tilt')).toBeCloseTo(dof(b, bottom, 'pelvis.tilt'), 6)
    expect(seamRatio(skel, b)).toBeLessThan(1.5)
  })
})

import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../../bake.ts'
import { bodyCapsules } from '../../collide.ts'
import { fk, segPos, sitePos } from '../../fk.ts'
import { siteWorld } from '../../implements.ts'
import { RING_HEIGHT } from '../../implements/index.ts'
import { dist, RAD, sub, type V3 } from '../../math.ts'
import { testSkeleton } from '../../testing.ts'
import { getTemplate, parseParams } from '../index.ts'
import { RING_LEAN, ringLean } from '../rings.ts'
import { JM, jmElbow } from './jm.ts'

// Wave 3c triceps-extension variants: the JM press (731) and the ring extension (743). The shared checks (elbow
// band, contacts, seam) run in triceps-extension.test.ts over every record.

const skel = testSkeleton()
const T = 'triceps-extension'
const run = (raw: Record<string, unknown>, laterality = 'bilateral') => bake(getTemplate(T), parseParams(T, raw, laterality), skel)
const jm = run({ implement: 'barbell', grip: 'pronated', gripWidth: 1, posture: 'lying_supine', benchAngle: 0, shoulderFlexion: 90 })
const rings = run({ implement: 'rings', grip: 'pronated', gripWidth: 1, posture: 'standing', shoulderFlexion: 120 })
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const TOP = 0
const BOTTOM = (b: Baked) => (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] / 2) / (b.tempo[0] + b.tempo[1] + b.tempo[2] + b.tempo[3])
const fAt = (b: Baked, u: number) => fk(skel, frameQ(b, at(b, u)))
const implAt = (b: Baked, u: number, id: string) => frameImplements(b, at(b, u))[b.implements.findIndex((s) => s.id === id)]

describe('JM press (731)', () => {
  it('locks out over the shoulders and lowers the bar to a hand above the throat, upper arms tilted towards the feet', () => {
    const top = fAt(jm, TOP), bottom = fAt(jm, BOTTOM(jm))
    const barTop = implAt(jm, TOP, 'bar').pos as V3, barBottom = implAt(jm, BOTTOM(jm), 'bar').pos as V3
    expect(Math.abs(barTop[2] - segPos(skel, top, 'humerus_l')[2])).toBeLessThan(0.02)
    // over the throat: between the shoulder line and the chin, 8-16 cm above the chin's height
    const chin = sitePos(skel, bottom, 'chin'), sh = segPos(skel, bottom, 'humerus_l')
    expect(barBottom[2]).toBeLessThan(sh[2] - 0.08)
    expect(barBottom[2]).toBeGreaterThan(chin[2])
    expect(barBottom[1] - chin[1]).toBeGreaterThan(0.08)
    expect(barBottom[1] - chin[1]).toBeLessThan(0.16)
    // the elbows bend to JM.elbow with the upper arm leaning JM.tilt towards the feet
    expect(frameQ(jm, at(jm, BOTTOM(jm)))[skel.dof['elbow_l.flex']]).toBeCloseTo(JM.elbow, 0)
    const e = jmElbow(skel, frameQ(jm, at(jm, BOTTOM(jm))))
    expect(Math.atan2(e.feet, e.up) * RAD).toBeCloseTo(JM.tilt, 0)
    // at lockout the upper arm is about vertical
    const e0 = jmElbow(skel, frameQ(jm, at(jm, TOP)))
    expect(Math.abs(Math.atan2(e0.feet, e0.up) * RAD)).toBeLessThan(15)
  })

  it('the bar runs one straight line, clear of the face, and the uprights stand behind its lowest point', () => {
    const k = jm.implements.findIndex((s) => s.id === 'bar')
    const p0 = frameImplements(jm, at(jm, TOP))[k].pos as V3, p1 = frameImplements(jm, at(jm, BOTTOM(jm)))[k].pos as V3
    const dir = sub(p1, p0)
    let face = Infinity
    for (let i = 0; i < jm.frames; i++) {
      const p = frameImplements(jm, i)[k].pos as V3
      const d = sub(p, p0)
      const along = (d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2]) / (dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2)
      expect(dist(p, [p0[0] + along * dir[0], p0[1] + along * dir[1], p0[2] + along * dir[2]])).toBeLessThan(1e-6)
      const head = bodyCapsules(skel, fk(skel, frameQ(jm, i))).filter((c) => c.region === 'head' || c.region === 'neck')
      for (const c of head) face = Math.min(face, Math.min(dist(c.a, p), dist(c.b, p)) - c.r)
    }
    expect(face).toBeGreaterThan(0.05)
    const rack = jm.implements.find((s) => s.kind === 'bench_rack')!
    const rackPose = frameImplements(jm, 0)[jm.implements.indexOf(rack)]
    expect(rackPose.pos[2] + rack.sites.l.pos[2]).toBeLessThan(p1[2] - 0.05)
  })

  it('JM press variants it does not cover throw', () => {
    expect(() => run({ implement: 'barbell', posture: 'lying_supine' }, 'unilateral')).toThrow(/variant not implemented yet/)
  })
})

describe('ring triceps extension (743)', () => {
  it('leans into rings at chest height, the forehead passing between them at the bottom, the rings staying put', () => {
    const b = rings
    const ids = ['ring_l', 'ring_r'].map((id) => b.implements.findIndex((s) => s.id === id))
    const anchor = b.implements.find((s) => s.id === 'rings')!
    const ai = b.implements.indexOf(anchor)
    const grip0 = ids.map((k) => siteWorld(b.implements[k], frameImplements(b, 0)[k], 'grip').pos)
    expect(grip0[0][1]).toBeCloseTo(RING_HEIGHT.triceps_extension, 3)
    for (let i = 0; i < b.frames; i++) {
      const impl = frameImplements(b, i)
      ids.forEach((k, j) => {
        expect(dist(siteWorld(b.implements[k], impl[k], 'grip').pos, grip0[j])).toBeLessThan(0.002)
        expect(ringLean({ anchor: anchor as never, anchorPose: impl[ai], implements: b.implements }, impl[k], j ? 'r' : 'l')).toBeLessThan(RING_LEAN + 9)
      })
    }
    // the forehead reaches the rings' line between them at the bottom, and stays behind it at lockout
    const front = (u: number) => Math.max(...bodyCapsules(skel, fAt(b, u)).filter((c) => c.region === 'head').map((c) => Math.max(c.a[2], c.b[2]) + c.r))
    expect(front(BOTTOM(b))).toBeGreaterThan(grip0[0][2])
    expect(front(TOP)).toBeLessThan(grip0[0][2] - 0.15)
    // between the rings: the head inside the grips
    const head = segPos(skel, fAt(b, BOTTOM(b)), 'head')
    expect(Math.abs(head[0])).toBeLessThan(grip0[0][0] - 0.1)
  })

  it('the body leans as one plank from the balls of the feet, more at the bottom; the elbows point down in front', () => {
    const b = rings
    const lean = (u: number) => frameQ(b, at(b, u))[skel.dof['pelvis.tilt']]
    expect(lean(TOP)).toBeGreaterThan(30)
    expect(lean(TOP)).toBeLessThan(45)
    expect(lean(BOTTOM(b)) - lean(TOP)).toBeGreaterThan(10)
    for (let i = 0; i < b.frames; i += 3) {
      const q = frameQ(b, i)
      for (const n of ['hip_l.flex', 'lumbar.flex', 'thorax.flex']) expect(Math.abs(q[skel.dof[n]]), n).toBeLessThan(1e-6)
    }
    const f = fAt(b, BOTTOM(b))
    const elbow = segPos(skel, f, 'forearm_l'), hand = sitePos(skel, f, 'grip_l')
    expect(elbow[1]).toBeLessThan(hand[1])
    expect(elbow[2]).toBeGreaterThan(segPos(skel, f, 'humerus_l')[2])
  })
})

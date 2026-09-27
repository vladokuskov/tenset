import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, qconj, qrot, sub } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('vertical-pull')
const baked = new Map(variants.map((v) => [v.slug, bake(getTemplate('vertical-pull'), parseParams('vertical-pull', v.params, v.laterality), skel)]))
const get = (slug: string) => baked.get(slug)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]

function gripError(b: Baked) {
  let worst = 0
  for (let i = 0; i < b.frames; i++) {
    const f = fk(skel, frameQ(b, i))
    const impl = frameImplements(b, i)
    for (const c of b.contacts) {
      if (c.kind !== 'grip' || !('implement' in c.target)) continue
      const { implement, grip } = c.target
      const k = b.implements.findIndex((s) => s.id === implement)
      worst = Math.max(worst, dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], grip).pos))
    }
  }
  return worst
}

describe('vertical-pull template', () => {
  it.each([...baked.keys()])('%s: hands stay on the bar', (slug) => {
    expect(gripError(get(slug))).toBeLessThan(0.005)
  })

  it('pull-up: dead hang with elevated shoulders to chin over the bar with the scapulae down', () => {
    const b = get('301-pull-up')
    expect(dof(b, 0.625, 'elbow_l.flex')).toBeLessThan(8)
    expect(dof(b, 0.625, 'shoulder_l.elev')).toBeGreaterThan(155)
    expect(dof(b, 0, 'elbow_l.flex')).toBeGreaterThan(110)
    expect(dof(b, 0, 'shoulder_l.elev')).toBeLessThan(75)
    expect(dof(b, 0.625, 'clavicle_l.elev')).toBeGreaterThan(dof(b, 0, 'clavicle_l.elev') + 15)
    const top = fk(skel, frameQ(b, 0))
    expect(sitePos(skel, top, 'chin')[1]).toBeGreaterThan(frameImplements(b, 0)[0].pos[1])
  })

  it('pull-up: scapular depression and downward rotation lead the elbows (not a linear blend)', () => {
    const b = get('301-pull-up')
    const n = b.frames
    // concentric frames from the bottom pause to the top
    const frames = Array.from({ length: n }, (_, i) => i).filter((i) => i / n > 0.68 && i / n < 0.93)
    const share = (i: number, name: string, lo: number, hi: number) => (frameQ(b, i)[skel.dof[name]] - lo) / (hi - lo)
    const [cHang, cTop] = [dof(b, 0.625, 'clavicle_l.elev'), dof(b, 0, 'clavicle_l.elev')]
    const [eHang, eTop] = [dof(b, 0.625, 'elbow_l.flex'), dof(b, 0, 'elbow_l.flex')]
    const early = frames.find((i) => share(i, 'elbow_l.flex', eHang, eTop) > 0.25)!
    expect(share(early, 'clavicle_l.elev', cHang, cTop)).toBeGreaterThan(0.5)
    expect(dof(b, 0.625, 'scapula_l.uprot')).toBeGreaterThan(dof(b, 0, 'scapula_l.uprot') + 10)
  })

  it('close-grip pulldown finishes with the elbows by the sides', () => {
    const b = get('311-close-grip-pulldown')
    const f = fk(skel, frameQ(b, 0))
    const th = f.rot[skel.seg.thorax2]
    const e = qrot(qconj(th), sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'thorax2')))
    expect(Math.abs(e[0])).toBeLessThan(0.26)
    expect(dof(b, 0, 'shoulder_l.elev')).toBeLessThan(25)
  })

  it('pulldowns fix the pelvis to the seat and bring the bar past the face to the chest', () => {
    for (const slug of ['303-lat-pulldown', '311-close-grip-pulldown']) {
      const b = get(slug)
      const hip0 = sitePos(skel, fk(skel, frameQ(b, 0)), 'hip_crease')
      let minAhead = Infinity
      for (let i = 0; i < b.frames; i += 2) {
        const f = fk(skel, frameQ(b, i))
        expect(dist(sitePos(skel, f, 'hip_crease'), hip0)).toBeLessThan(0.03)
        const bar = frameImplements(b, i)[0].pos
        const chin = sitePos(skel, f, 'chin')
        if (Math.abs(bar[1] - chin[1]) < 0.1) minAhead = Math.min(minAhead, bar[2] - chin[2])
      }
      expect(minAhead).toBeGreaterThan(0.03)
      expect(dof(b, 0.625, 'elbow_l.flex')).toBeLessThan(20)
      expect(dof(b, 0, 'elbow_l.flex')).toBeGreaterThan(100)
    }
  })

  it('assisted pull-up kneels on a pad that rides with the knees', () => {
    const b = get('302-assisted-pull-up')
    expect(dof(b, 0.3, 'knee_l.flex')).toBeCloseTo(90, 0)
    const pad = (i: number) => frameImplements(b, i)[1].pos[1]
    expect(pad(at(b, 0)) - pad(at(b, 0.625))).toBeGreaterThan(0.3)
  })
})

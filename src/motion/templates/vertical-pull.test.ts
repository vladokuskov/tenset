import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, qconj, qrot, sub, type V3 } from '../math.ts'
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

  it('wide-grip pull-up: hands wider than the pull-up, same dead hang to chin over the bar', () => {
    const wide = get('328-wide-grip-pull-up')
    const std = get('301-pull-up')
    const gap = (b: Baked) => dist(...(['grip_l', 'grip_r'].map((s) => sitePos(skel, fk(skel, frameQ(b, 0)), s)) as [V3, V3]))
    expect(gap(wide)).toBeGreaterThan(gap(std) + 0.08)
    expect(dof(wide, 0.625, 'elbow_l.flex')).toBeLessThan(8)
    expect(sitePos(skel, fk(skel, frameQ(wide, 0)), 'chin')[1]).toBeGreaterThan(frameImplements(wide, 0)[0].pos[1])
  })

  it('pulldown variants: arms long at the top, bar or handle brought down to the chest', () => {
    for (const slug of ['329-underhand-lat-pulldown', '330-single-arm-cable-pulldown', '331-neutral-grip-lat-pulldown']) {
      const b = get(slug)
      const s = b.params.laterality === 'unilateral' && b.params.side !== 'left' ? 'r' : 'l'
      expect(dof(b, 0.625, `elbow_${s}.flex`), slug).toBeLessThan(20)
      expect(dof(b, 0.625, `shoulder_${s}.elev`), slug).toBeGreaterThan(140)
      expect(dof(b, 0, `elbow_${s}.flex`), slug).toBeGreaterThan(90)
      expect(dof(b, 0, `shoulder_${s}.elev`), slug).toBeLessThan(45)
      const f = fk(skel, frameQ(b, 0))
      expect(sitePos(skel, f, `grip_${s}`)[1], slug).toBeLessThan(segPos(skel, f, `humerus_${s}`)[1] + 0.08)
    }
  })

  it('underhand pulldown: forearms supinated, elbows by the sides at the finish', () => {
    const b = get('329-underhand-lat-pulldown')
    expect(dof(b, 0, 'forearm_l.pro')).toBeLessThan(-70)
    const f = fk(skel, frameQ(b, 0))
    const th = f.rot[skel.seg.thorax2]
    const e = qrot(qconj(th), sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'thorax2')))
    expect(Math.abs(e[0])).toBeLessThan(0.3)
  })

  it('single-arm pulldown: only the working arm pulls, its elbow ends close to the side', () => {
    const b = get('330-single-arm-cable-pulldown')
    expect(b.contacts.filter((c) => c.kind === 'grip')).toHaveLength(1)
    // the resting hand stays on the thigh pad: the arm only follows the small trunk lean
    expect(Math.abs(dof(b, 0, 'shoulder_l.elev') - dof(b, 0.625, 'shoulder_l.elev'))).toBeLessThan(3)
    expect(Math.abs(dof(b, 0, 'elbow_l.flex') - dof(b, 0.625, 'elbow_l.flex'))).toBeLessThan(8)
    const f = fk(skel, frameQ(b, 0))
    const th = f.rot[skel.seg.thorax2]
    const e = qrot(qconj(th), sub(segPos(skel, f, 'forearm_r'), segPos(skel, f, 'thorax2')))
    expect(Math.abs(e[0])).toBeLessThan(0.33)
  })

  it('scapular pull-up (342): shoulders draw down from the dead hang with the elbows straight, the body rising a few cm', () => {
    const b = get('342-scapular-pull-up')
    expect(gripError(b)).toBeLessThan(0.005)
    for (let i = 0; i < b.frames; i += 5) expect(frameQ(b, i)[skel.dof['elbow_l.flex']]).toBeLessThan(10)
    expect(dof(b, 0.625, 'clavicle_l.elev')).toBeGreaterThan(15)
    expect(dof(b, 0, 'clavicle_l.elev')).toBeLessThan(0)
    const rise = dof(b, 0, 'pelvis.ty') - dof(b, 0.625, 'pelvis.ty')
    expect(rise).toBeGreaterThan(0.03)
    expect(rise).toBeLessThan(0.15)
  })

  it('band-assisted pull-up (334): the pull-up with a band from the bar round the left shin', () => {
    const b = get('334-band-assisted-pull-up')
    expect(gripError(b)).toBeLessThan(0.005)
    const f = fk(skel, frameQ(b, 0))
    expect(sitePos(skel, f, 'chin')[1]).toBeGreaterThan(2.4)
    const knee = frameImplements(b, 0)[b.implements.findIndex((s) => s.id === 'band_knee')].pos
    expect(dist(knee, segPos(skel, f, 'tibia_l'))).toBeLessThan(1e-4)
  })

  it('band pulldown (332): kneeling on the mat, the fists from up towards a high anchor down beside the upper chest', () => {
    const b = get('332-band-lat-pulldown')
    expect(gripError(b)).toBeLessThan(0.005)
    const top = fk(skel, frameQ(b, at(b, 0.625))), end = fk(skel, frameQ(b, at(b, 0)))
    expect(sitePos(skel, top, 'grip_l')[1]).toBeGreaterThan(segPos(skel, top, 'head')[1] + 0.2)
    expect(sitePos(skel, end, 'grip_l')[1]).toBeLessThan(segPos(skel, end, 'head')[1])
    // elbows by the sides at the finish: below the shoulders
    expect(segPos(skel, end, 'forearm_l')[1]).toBeLessThan(segPos(skel, end, 'humerus_l')[1] - 0.15)
    // kneeling: knees and the pelvis still
    expect(Math.abs(dof(b, 0, 'pelvis.ty') - dof(b, 0.625, 'pelvis.ty'))).toBeLessThan(1e-6)
  })
})

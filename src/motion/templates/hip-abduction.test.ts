import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('hip-abduction')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('hip-abduction'), parseParams('hip-abduction', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, i: number, name: string) => frameQ(b, i)[skel.dof[name]]
/** top of the rep (end of the concentric) and the stretch */
const TOP = 0, STRETCH = 0.625

function contactError(b: Baked, i: number) {
  const f = fk(skel, frameQ(b, i))
  const impl = frameImplements(b, i)
  let worst = 0
  for (const c of b.contacts) {
    const p = sitePos(skel, f, c.site)
    if ('world' in c.target) worst = Math.max(worst, dist(p, c.target.world))
    else {
      const { implement, grip } = c.target
      const k = b.implements.findIndex((s) => s.id === implement)
      worst = Math.max(worst, dist(p, siteWorld(b.implements[k], impl[k], grip).pos))
    }
  }
  return worst
}

describe('hip-abduction template', () => {
  it('covers every family record', () => {
    expect([...baked.keys()].sort()).toEqual([506, 507, 514, 515])
  })

  it.each([...baked.keys()])('%s: finite, contacts held, the loop closes', (id) => {
    const b = get(id)
    expect(b.q.every(Number.isFinite)).toBe(true)
    for (let i = 0; i < b.frames; i++) expect(contactError(b, i)).toBeLessThan(0.005)
    const q0 = frameQ(b, 0), q1 = frameQ(b, b.frames - 1)
    for (const d of skel.dofs) if (d.unit !== 'm') expect(Math.abs(q0[d.index] - q1[d.index]), d.name).toBeLessThan(1.5)
  })

  it('seated machine: thighs swing 30-45 deg per side at 90 deg hip flexion, knees and hips otherwise fixed', () => {
    for (const [id, dir] of [[506, 'abduction'], [507, 'adduction']] as const) {
      const b = get(id)
      const top = dof(b, at(b, TOP), 'hip_l.abd'), stretch = dof(b, at(b, STRETCH), 'hip_l.abd')
      // abduction: knees together -> apart; adduction the reverse
      const [open, closed] = dir === 'abduction' ? [top, stretch] : [stretch, top]
      expect(open).toBeGreaterThanOrEqual(35)
      expect(open).toBeLessThanOrEqual(45)
      expect(closed).toBeLessThan(10)
      for (let i = 0; i < b.frames; i += 4) {
        expect(dof(b, i, 'hip_r.abd')).toBeCloseTo(dof(b, i, 'hip_l.abd'), 6)
        expect(dof(b, i, 'hip_l.flex')).toBeCloseTo(90, 6)
        expect(dof(b, i, 'knee_l.flex')).toBeCloseTo(80, 6)
      }
    }
  })

  it('seated machine: the leg pads stay on the knees (outside on abduction, inside on adduction)', () => {
    for (const [id, out] of [[506, 1], [507, -1]] as const) {
      const b = get(id)
      for (let i = 0; i < b.frames; i += 5) {
        const caps = bodyCapsules(skel, fk(skel, frameQ(b, i)))
        const impl = frameImplements(b, i)
        const k = b.implements.findIndex((s) => s.id === 'arm_l')
        const [pad] = placeParts(b.implements[k], impl[k])
        const leg = caps.filter((c) => c.region === 'thigh_l' || c.region === 'shank_l')
        const gap = Math.min(...leg.map((c) => capsuleSolidClearance(c, pad)))
        expect(gap).toBeLessThan(0.002)
        expect(gap).toBeGreaterThan(-0.015)
        // pad centre on the named side of the knee
        const knee = fk(skel, frameQ(b, i)).pos[skel.seg.tibia_l]
        expect(Math.sign(pad.center[0] - knee[0])).toBe(out)
      }
    }
  })

  it('standing cable: pelvis level, working knee straight, foot off the floor, hip ranges from the research', () => {
    for (const [id, dir, maxFlex] of [[514, 'abduction', 24], [515, 'adduction', 30]] as const) {
      const b = get(id)
      const flex = (i: number) => dof(b, (i + b.frames) % b.frames, 'hip_r.flex')
      for (let i = 0; i < b.frames; i++) {
        const q = frameQ(b, i)
        expect(Math.abs(q[skel.dof['pelvis.list']])).toBeLessThan(0.5)
        expect(q[skel.dof['knee_r.flex']]).toBeLessThan(8)
        // the hip flexes only as keyed (the floor-clearance guard never kicks in) and without corners
        expect(q[skel.dof['hip_r.flex']]).toBeLessThanOrEqual(maxFlex + 1e-6)
        // third difference per frame: a guard switching in or out showed ~1.6 (42k deg/s3 at 30 fps)
        expect(Math.abs(flex(i + 2) - 3 * flex(i + 1) + 3 * flex(i) - flex(i - 1)), `${id} hip flexion kink @${i}`).toBeLessThan(0.9)
        const low = Math.min(...bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'foot_r').map((c) => Math.min(c.a[1], c.b[1]) - c.r))
        expect(low).toBeGreaterThan(0.01)
      }
      const top = dof(b, at(b, TOP), 'hip_r.abd'), stretch = dof(b, at(b, STRETCH), 'hip_r.abd')
      if (dir === 'abduction') {
        expect(top).toBeGreaterThanOrEqual(30)
        expect(top).toBeLessThanOrEqual(45)
        expect(stretch).toBeLessThan(2)
      } else {
        expect(stretch).toBeGreaterThanOrEqual(20)
        expect(top).toBeLessThan(0)
        // the working foot finishes across, in front of the standing foot
        const f = fk(skel, frameQ(b, at(b, TOP)))
        const work = sitePos(skel, f, 'ball_r'), stand = sitePos(skel, f, 'ball_l')
        expect(stand[0] - work[0]).toBeLessThan(0.06)
        expect(work[2] - stand[2]).toBeGreaterThan(0.2)
      }
    }
  })

  it('throws for variants it does not draw', () => {
    const t = getTemplate('hip-abduction')
    for (const raw of [{ implement: 'bodyweight', posture: 'side_lying' }, { implement: 'machine', posture: 'standing' }]) {
      expect(() => t.setup(parseParams('hip-abduction', raw), skel)).toThrow(/variant not implemented yet/)
    }
  })
})

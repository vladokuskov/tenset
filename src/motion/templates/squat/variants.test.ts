import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../../bake.ts'
import { centerOfMass, fk, segPos, sitePos } from '../../fk.ts'
import { siteWorld } from '../../implements.ts'
import { bandPath, isBand } from '../../implements/bands.ts'
import { dist } from '../../math.ts'
import { loopDuration } from '../../timing.ts'
import { testSkeleton } from '../../testing.ts'
import { SCHEMAS } from '../schemas.ts'
import { squat } from '../squat.ts'

// Tier C squats (wave 3c): hack, reverse hack, pendulum and belt squat, landmine squat, band Spanish squat, box pistol,
// sissy squat. Ranges are author judgment against the squat research (knee ~110-120 deep, ankle dorsiflexion <= 40).

const skel = testSkeleton()
const RECORDS: Record<number, [Record<string, unknown>, string]> = {
  413: [{ implement: 'machine', machine: 'hack_squat' }, 'bilateral'],
  414: [{ implement: 'machine', machine: 'pendulum_squat' }, 'bilateral'],
  415: [{ implement: 'machine', machine: 'belt_squat' }, 'bilateral'],
  416: [{ implement: 'machine', machine: 'hack_squat', reverse: true }, 'bilateral'],
  419: [{ implement: 'landmine', hold: 'goblet' }, 'bilateral'],
  428: [{ implement: 'bodyweight', hold: 'hands', sissy: true }, 'bilateral'],
  432: [{ implement: 'bodyweight', hold: 'hands', stance: 'single_leg', box: true, depth: 'parallel' }, 'unilateral'],
  436: [{ implement: 'band', hold: 'hands', depth: 'parallel' }, 'bilateral'],
}
const params = (id: number) => SCHEMAS.squat.parse({ ...RECORDS[id][0], laterality: RECORDS[id][1] })
const baked = new Map(Object.keys(RECORDS).map((id) => [Number(id), bake(squat, params(Number(id)), skel)]))
const get = (id: number) => baked.get(id)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const bottom = (b: Baked) => {
  const [ecc, pb, , pt] = b.tempo
  return at(b, (pt / 2 + ecc + pb / 2) / loopDuration(b.tempo))
}
const dof = (b: Baked, i: number, name: string) => frameQ(b, i)[skel.dof[name]]
const implPos = (b: Baked, i: number, kind: string) => frameImplements(b, i)[b.implements.findIndex((s) => s.kind === kind)]

describe('squat tier C variants', () => {
  it.each([...baked.keys()])('%s: finite, planted feet still, hands on their handles, the loop closes', (id) => {
    const b = get(id)
    expect(b.q.every(Number.isFinite)).toBe(true)
    const f0 = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i += 2) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind === 'planted') expect(dist(sitePos(skel, f, c.site), sitePos(skel, f0, c.site)), c.site).toBeLessThan(0.002)
        if (c.kind !== 'grip' || !('implement' in c.target)) continue
        const k = b.implements.findIndex((s) => s.id === (c.target as { implement: string }).implement)
        expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], c.target.grip).pos), c.site).toBeLessThan(0.005)
      }
    }
    const step = (i: number, j: number) => Math.max(...Array.from(frameQ(b, i), (x, k) => Math.abs(x - frameQ(b, j)[k])))
    expect(step(b.frames - 1, 0)).toBeLessThan(0.5)
  })

  it('hack squat: the trunk rides the sled at the rail angle, knees ~5 -> ~110 with the heels down; reversed, the chest on the pad', () => {
    const b = get(413)
    for (let i = 0; i < b.frames; i += 5) expect(dof(b, i, 'pelvis.tilt')).toBeCloseTo(-45, 6)
    expect(dof(b, 0, 'knee_l.flex')).toBeLessThan(6)
    expect(dof(b, bottom(b), 'knee_l.flex')).toBeGreaterThan(105)
    expect(dof(b, bottom(b), 'hip_l.flex')).toBeGreaterThan(60)
    expect(dof(b, bottom(b), 'ankle_l.df')).toBeLessThan(25)
    // the sled comes down the rails and back
    expect(implPos(b, 0, 'hack_sled').pos[1] - implPos(b, bottom(b), 'hack_sled').pos[1]).toBeGreaterThan(0.2)
    const r = get(416)
    // the machine is turned round the lifter, who leans forward into the pad (no yaw: the symmetry gate holds)
    for (let i = 0; i < r.frames; i += 5) {
      expect(dof(r, i, 'pelvis.tilt')).toBeCloseTo(45, 6)
      expect(dof(r, i, 'pelvis.rot')).toBe(0)
    }
    expect(dof(r, bottom(r), 'knee_l.flex')).toBeGreaterThan(95)
    expect(dof(r, bottom(r), 'hip_l.flex')).toBeGreaterThan(80)
  })

  it('pendulum squat: the pad swings from leaning back to about upright, knees far forward, heels down', () => {
    const b = get(414)
    expect(dof(b, 0, 'pelvis.tilt')).toBeCloseTo(-20, 3)
    expect(dof(b, bottom(b), 'pelvis.tilt')).toBeGreaterThan(-5)
    expect(dof(b, bottom(b), 'knee_l.flex')).toBeGreaterThan(105)
    expect(dof(b, bottom(b), 'ankle_l.df')).toBeLessThan(40)
  })

  it('belt squat: the trunk stays near upright, the chain keeps its length, the hands stay on the grab bar', () => {
    const b = get(415)
    expect(dof(b, bottom(b), 'knee_l.flex')).toBeGreaterThan(100)
    for (let i = 0; i < b.frames; i += 5) expect(dof(b, i, 'pelvis.tilt')).toBeLessThan(23)
    const belt = b.implements.find((s) => s.kind === 'hip_belt')!, lever = b.implements.find((s) => s.kind === 'belt_lever')!
    const chain = (i: number) => {
      const impl = frameImplements(b, i)
      const ring = siteWorld(belt, impl[b.implements.indexOf(belt)], 'front').pos
      const hook = siteWorld(lever, impl[b.implements.indexOf(lever)], 'hook').pos
      return dist(ring, hook)
    }
    for (let i = 0; i < b.frames; i += 7) expect(chain(i)).toBeCloseTo(chain(0), 4)
    // the centre of mass over the midfeet
    for (let i = 0; i < b.frames; i += 7) {
      const f = fk(skel, frameQ(b, i))
      const mid = (sitePos(skel, f, 'midfoot_l')[2] + sitePos(skel, f, 'midfoot_r')[2]) / 2
      expect(Math.abs(centerOfMass(skel, f)[2] - mid)).toBeLessThan(0.025)
    }
  })

  it('landmine squat: the cupped tip rides on the sphere round the pivot, lower and further from it at the bottom', () => {
    const b = get(419)
    const bar = b.implements.find((s) => s.kind === 'landmine_bar')!
    const k = b.implements.indexOf(bar)
    const tip = (i: number) => siteWorld(bar, frameImplements(b, i)[k], 'cup_l').pos
    const pivot = frameImplements(b, 0)[k].pos
    for (let i = 0; i < b.frames; i += 5) expect(dist(frameImplements(b, i)[k].pos, pivot)).toBeLessThan(1e-9)
    expect(tip(0)[1] - tip(bottom(b))[1]).toBeGreaterThan(0.3)
    expect(Math.abs(tip(bottom(b))[2] - pivot[2])).toBeGreaterThan(Math.abs(tip(0)[2] - pivot[2]))
    expect(dof(b, bottom(b), 'knee_l.flex')).toBeGreaterThan(105)
    expect(dof(b, bottom(b), 'ankle_l.df')).toBeLessThan(30)
  })

  it('Spanish squat: shins near vertical, hips back, the band runs from behind both knees to the post ahead', () => {
    const b = get(436)
    for (let i = 0; i < b.frames; i += 3) expect(dof(b, i, 'ankle_l.df')).toBeLessThan(8)
    expect(dof(b, bottom(b), 'knee_l.flex')).toBeGreaterThan(90)
    const f = fk(skel, frameQ(b, bottom(b)))
    expect(segPos(skel, f, 'pelvis')[2]).toBeLessThan(sitePos(skel, f, 'heel_l')[2])
    const strip = b.implements.find(isBand)!
    const specs = new Map(b.implements.map((s) => [s.id, s]))
    const poses = new Map(frameImplements(b, bottom(b)).map((p) => [p.id, p]))
    const path = bandPath(strip, specs, poses)
    // behind the knees: the wrap's back points sit behind the knee joints
    const knee = segPos(skel, f, 'tibia_l')
    expect(Math.min(...path.map((v) => v.pos[2]))).toBeLessThan(knee[2] - 0.03)
    expect(Math.max(...path.map((v) => v.pos[2]))).toBeGreaterThan(knee[2] + 0.5)
  })

  it('box pistol: the centre of mass stays over the working midfoot, the free leg reaches forward clear of the floor, the glutes meet the box', () => {
    const b = get(432)
    for (let i = 0; i < b.frames; i += 3) {
      const f = fk(skel, frameQ(b, i))
      const c = centerOfMass(skel, f), m = sitePos(skel, f, 'midfoot_r')
      expect(Math.abs(c[0] - m[0])).toBeLessThan(0.01)
      expect(Math.abs(c[2] - m[2])).toBeLessThan(0.01)
      expect(sitePos(skel, f, 'heel_l')[1]).toBeGreaterThan(0.02)
    }
    expect(dof(b, bottom(b), 'knee_r.flex')).toBeGreaterThan(88)
    expect(dof(b, bottom(b), 'hip_l.flex')).toBeGreaterThan(80)
    expect(dof(b, bottom(b), 'ankle_r.df')).toBeLessThan(40)
  })

  it('sissy squat: on the balls, hips straight (knees to shoulders one line), knees ~110, the hand on the post', () => {
    const b = get(428)
    for (let i = 0; i < b.frames; i += 3) {
      expect(Math.abs(dof(b, i, 'hip_l.flex'))).toBeLessThan(6)
      const f = fk(skel, frameQ(b, i))
      expect(sitePos(skel, f, 'heel_l')[1]).toBeGreaterThan(0.03)
    }
    expect(dof(b, bottom(b), 'knee_l.flex')).toBeGreaterThan(105)
    expect(dof(b, bottom(b), 'pelvis.tilt')).toBeLessThan(-35)
  })

  it.each([
    ['single leg without the box', { implement: 'bodyweight', stance: 'single_leg' }],
    ['sissy with a bar', { implement: 'barbell', sissy: true }],
    ['landmine one-handed', { implement: 'landmine', hold: 'hands', stance: 'single_leg' }],
  ])('%s: throws variant not implemented yet', (_, raw) => {
    expect(() => squat.setup(SCHEMAS.squat.parse({ ...raw, laterality: 'bilateral' }), skel)).toThrow(/variant not implemented yet/)
  })
})

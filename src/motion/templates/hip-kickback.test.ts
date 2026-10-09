import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules } from '../collide.ts'
import { fk, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { REVERSE_HYPER } from '../implements/stations.ts'
import { dist } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { CABLE_HIP, HYPER_HIP } from './hip-kickback.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('hip-kickback')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('hip-kickback'), parseParams('hip-kickback', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const at = (x: Baked, u: number) => Math.round(u * x.frames) % x.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]

describe('hip-kickback template', () => {
  it('covers every hip-kickback record', () => {
    expect([...baked.keys()].sort()).toEqual([528, 534])
  })

  it.each([528, 534])('%s: finite, contacts held, the loop closes', (id) => {
    const b = get(id)
    expect(b.q.every(Number.isFinite)).toBe(true)
    const first = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i += 3) {
      const f = fk(skel, frameQ(b, i))
      const poses = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind === 'planted') expect(dist(sitePos(skel, f, c.site), sitePos(skel, first, c.site))).toBeLessThan(0.002)
        else if ('implement' in c.target) {
          const spec = b.implements.find((s) => s.id === (c.target as { implement: string }).implement)!
          expect(dist(sitePos(skel, f, c.site), siteWorld(spec, poses.find((p) => p.id === spec.id)!, (c.target as { grip: string }).grip).pos)).toBeLessThan(0.005)
        }
      }
    }
    const a = frameQ(b, 0), z = frameQ(b, b.frames - 1)
    for (const d of skel.dofs) if (d.unit === 'deg') expect(Math.abs(a[d.index] - z[d.index])).toBeLessThan(1)
  })

  it('reverse hyper: prone on the high pad, both straight legs swing from hanging to in line with the body', () => {
    const b = get(528)
    expect(dof(b, 0, 'pelvis.tilt')).toBeCloseTo(90, 3)
    expect(dof(b, 0, 'hip_l.flex')).toBeCloseTo(HYPER_HIP.top, 0)
    expect(dof(b, 0.625, 'hip_l.flex')).toBeCloseTo(HYPER_HIP.bottom, 0)
    expect(dof(b, 0.625, 'hip_r.flex')).toBeCloseTo(HYPER_HIP.bottom, 0)
    for (let i = 0; i < b.frames; i += 4) {
      const q = frameQ(b, i)
      expect(q[skel.dof['knee_l.flex']]).toBe(Number(b.params.kneeAngle))
      // the feet never reach the floor
      const caps = bodyCapsules(skel, fk(skel, q)).filter((c) => /^foot_/.test(c.region))
      expect(Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r))).toBeGreaterThan(0.03)
    }
    // the trunk rests on the pad, the hip joints just past its edge
    const f = fk(skel, frameQ(b, 0))
    expect(f.pos[skel.seg.femur_l][2]).toBeLessThan(0)
    expect(f.pos[skel.seg.femur_l][1]).toBeGreaterThan(REVERSE_HYPER.padTop)
  })

  it('cable kickback: the strapped leg swings from in front of the body to ~15 deg of hip extension, the stance foot still', () => {
    const b = get(534)
    const w = b.params.side === 'left' ? 'l' : 'r'
    expect(dof(b, 0, `hip_${w}.flex`)).toBeCloseTo(CABLE_HIP.top, 0)
    expect(dof(b, 0.625, `hip_${w}.flex`)).toBeCloseTo(CABLE_HIP.stretch, 0)
    // the working foot stays off the floor, its knee bending more towards the stretch
    for (let i = 0; i < b.frames; i += 3) {
      const caps = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region === `foot_${w}`)
      expect(Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r))).toBeGreaterThan(0.005)
    }
    expect(dof(b, 0.625, `knee_${w}.flex`)).toBeGreaterThan(dof(b, 0, `knee_${w}.flex`))
    expect(b.cables?.length).toBe(1)
  })

  it('throws for variants it does not draw yet', () => {
    const t = getTemplate('hip-kickback')
    for (const [raw, lat] of [[{ implement: 'band' }, 'unilateral'], [{ implement: 'bodyweight', posture: 'kneeling' }, 'unilateral'], [{ implement: 'bodyweight', posture: 'lying_prone' }, 'bilateral'], [{ attachment: 'ankle_strap' }, 'bilateral']] as const) {
      expect(() => t.sample(0, parseParams('hip-kickback', raw, lat), skel)).toThrow(/variant not implemented yet/)
    }
  })
})

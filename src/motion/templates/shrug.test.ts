import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { angleBetween, dist, qconj, qrot, RAD, sub } from '../math.ts'
import { bandPath, isBand } from '../implements/index.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('shrug')
const baked = new Map(variants.map((v) => [v.slug, bake(getTemplate('shrug'), parseParams('shrug', v.params, v.laterality), skel)]))
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const TOP = 0
const BOTTOM = 0.625
const dof = (b: Baked, i: number, name: string) => frameQ(b, i)[skel.dof[name]]

function range(b: Baked, fn: (i: number) => number) {
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < b.frames; i++) {
    const v = fn(i)
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return hi - lo
}

describe('shrug template', () => {
  it('covers every shrug record', () => {
    expect(variants.map((v) => v.id).sort()).toEqual([308, 314, 335, 336, 337, 341])
  })

  it.each([...baked.keys()])('%s: clavicles rise ~0 -> 25 deg straight up, no rolling, arms still', (slug) => {
    const b = baked.get(slug)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    for (const s of ['l', 'r']) {
      // research: clavicle elevation 0 -> ~25 (SC joint)
      expect(dof(b, at(b, BOTTOM), `clavicle_${s}.elev`)).toBeLessThan(2)
      expect(dof(b, at(b, TOP), `clavicle_${s}.elev`)).toBeGreaterThan(20)
      expect(dof(b, at(b, TOP), `clavicle_${s}.elev`)).toBeLessThan(30)
      // straight up: protraction does not move (no rolling), and the arms hang the same way throughout
      expect(range(b, (i) => dof(b, i, `clavicle_${s}.prot`))).toBeLessThan(0.5)
      // the trap bar's side handles are solved by IK each frame, which lets the elbows drift a little more
      expect(range(b, (i) => dof(b, i, `elbow_${s}.flex`))).toBeLessThan(slug.startsWith('335-') ? 3 : 1.5)
      // upper arm direction in the thorax frame (the plane angle is ill-defined for an arm this close to hanging)
      const hum = (i: number) => {
        const f = fk(skel, frameQ(b, i))
        const d = sub(segPos(skel, f, `forearm_${s}`), segPos(skel, f, `humerus_${s}`))
        return qrot(qconj(f.rot[skel.seg.thorax2]), d)
      }
      expect(angleBetween(hum(at(b, TOP)), hum(at(b, BOTTOM))) * RAD).toBeLessThan(3)
    }
    expect(range(b, (i) => dof(b, i, 'lumbar.flex') + dof(b, i, 'thorax.flex'))).toBeLessThan(0.5)
  })

  it.each([...baked.keys()])('%s: the load rises with the shoulders, hands on it, feet planted, loop closes', (slug) => {
    const b = baked.get(slug)!
    const first = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind === 'planted') expect(dist(sitePos(skel, f, c.site), sitePos(skel, first, c.site))).toBeLessThan(0.002)
        if (c.kind === 'grip' && 'implement' in c.target) {
          const { implement, grip } = c.target
          const k = b.implements.findIndex((s) => s.id === implement)
          expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], grip).pos)).toBeLessThan(0.005)
        }
      }
    }
    const lift = (fn: (i: number) => number) => fn(at(b, TOP)) - fn(at(b, BOTTOM))
    const shoulder = lift((i) => segPos(skel, fk(skel, frameQ(b, i)), 'humerus_l')[1])
    const load = lift((i) => frameImplements(b, i)[0].pos[1])
    expect(shoulder).toBeGreaterThan(0.05)
    expect(Math.abs(load - shoulder)).toBeLessThan(0.015)
    const step = Math.max(...frameQ(b, b.frames - 1).map((v, k) => Math.abs(v - frameQ(b, 0)[k])))
    expect(step).toBeLessThan(0.5)
  })

  it('Smith shrug: the bar rides one vertical line, on the rails', () => {
    const b = [...baked.entries()].find(([slug]) => slug.startsWith('337-'))![1]
    const z = Array.from({ length: b.frames }, (_, i) => frameImplements(b, i)[0].pos[2])
    expect(Math.max(...z) - Math.min(...z)).toBeLessThan(1e-6)
    const rails = b.implements.find((s) => s.id === 'smith')!
    const rail = rails.parts[0] as Extract<(typeof rails.parts)[number], { shape: 'cylinder' }>
    expect(Math.abs(rail.a[2] - z[0])).toBeLessThan(1e-6)
  })

  it('cable shrug: a straight bar on the low pulley in front of the feet, the cable pulling it forward and down', () => {
    const b = [...baked.entries()].find(([slug]) => slug.startsWith('336-'))![1]
    expect(b.cables!.length).toBe(1)
    const pulley = b.cables![0].pulley
    const first = fk(skel, frameQ(b, 0))
    const toes = Math.max(sitePos(skel, first, 'ball_l')[2], sitePos(skel, first, 'ball_r')[2])
    expect(pulley[1]).toBeLessThan(0.15)
    expect(pulley[2]).toBeGreaterThan(toes + 0.1)
    // the bar hangs in front of the thighs
    const bar = frameImplements(b, at(b, BOTTOM))[0].pos
    expect(bar[2]).toBeGreaterThan(segPos(skel, fk(skel, frameQ(b, at(b, BOTTOM))), 'femur_l')[2])
  })

  it('trap bar (335): standing inside the hexagon, neutral hands on the side handles, the frame clear of the legs', () => {
    const b = [...baked.entries()].find(([slug]) => slug.startsWith('335-'))![1]
    const bar = b.implements[0]
    expect(bar.kind).toBe('trap_bar')
    const pose = frameImplements(b, at(b, BOTTOM))[0]
    const f = fk(skel, frameQ(b, at(b, BOTTOM)))
    // the hands hang beside the thighs, outside the shoulders
    expect(siteWorld(bar, pose, 'l').pos[0]).toBeGreaterThan(segPos(skel, f, 'humerus_l')[0])
    // the hexagon's sleeve plane sits below the hands, around the thighs
    expect(pose.pos[1]).toBeLessThan(sitePos(skel, f, 'grip_l')[1])
    expect(pose.pos[1]).toBeGreaterThan(segPos(skel, f, 'tibia_l')[1])
  })

  it('band (341): standing on the band, the band runs from each fist under both soles', () => {
    const b = [...baked.entries()].find(([slug]) => slug.startsWith('341-'))![1]
    const spec = b.implements.find(isBand)!
    const poses = frameImplements(b, at(b, TOP))
    const path = bandPath(spec, new Map(b.implements.map((s) => [s.id, s])), new Map(b.implements.map((s, k) => [s.id, poses[k]])))
    expect(path.filter((v) => v.pos[1] < 0.005).length).toBe(4)
  })

  it('unsupported variants throw', () => {
    const t = getTemplate('shrug')
    expect(() => t.setup(parseParams('shrug', { implement: 'machine' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => t.setup(parseParams('shrug', { implement: 'dumbbell', posture: 'seated' }), skel)).toThrow(/variant not implemented yet/)
  })
})

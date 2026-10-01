import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, segRot, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { angleBetween, dist, qconj, qrot, RAD, sub, type V3 } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('triceps-extension')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('triceps-extension'), parseParams('triceps-extension', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
/** the working arm: the right one on unilateral work */
const arm = (b: Baked) => (b.params.laterality === 'unilateral' ? 'r' : 'l')
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name.replace('*', arm(b))]]
const range = (b: Baked, name: string) => {
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < b.frames; i++) {
    const v = frameQ(b, i)[skel.dof[name.replace('*', arm(b))]]
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return [lo, hi]
}

/** the working upper arm's direction in the thorax frame */
function humerus(b: Baked, i: number): V3 {
  const f = fk(skel, frameQ(b, i))
  const s = arm(b)
  return qrot(qconj(segRot(skel, f, 'thorax2')), sub(segPos(skel, f, `forearm_${s}`), segPos(skel, f, `humerus_${s}`)))
}

/** elbow flexion at lockout (u = 0, mid top pause) and at the stretch (mid bottom pause), and the expected stretch band */
const STRETCH: Record<number, [number, number]> = {
  // rope: forearms just past parallel (cue); bar: up to chest height (cue); research ~120-140 for the rest
  704: [100, 115],
  715: [110, 120],
  706: [110, 135],
  705: [125, 140],
  716: [110, 135],
  // kickback: "lower only to about a right angle"
  717: [88, 100],
}

describe('triceps-extension template', () => {
  it('covers every triceps-extension record', () => {
    expect([...baked.keys()].sort()).toEqual([704, 705, 706, 715, 716, 717])
  })

  it.each([...baked.keys()])('%s: elbow from lockout to its stretch band, upper arm still', (id) => {
    const b = get(id)
    expect(dof(b, 0, 'elbow_*.flex')).toBeLessThan(8)
    const u = (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] / 2) / (b.tempo[0] + b.tempo[1] + b.tempo[2] + b.tempo[3])
    const [lo, hi] = STRETCH[id]
    expect(dof(b, u, 'elbow_*.flex')).toBeGreaterThan(lo)
    expect(dof(b, u, 'elbow_*.flex')).toBeLessThan(hi)
    // the upper arm holds its direction against the trunk (pushdowns let it ease forward ~3 deg)
    const h0 = humerus(b, 0)
    let drift = 0
    for (let i = 0; i < b.frames; i++) drift = Math.max(drift, angleBetween(h0, humerus(b, i)) * RAD)
    expect(drift).toBeLessThan(6)
  })

  it('holds the variant shoulder angle', () => {
    const elevation = (id: number) => range(get(id), 'shoulder_*.elev')
    // pushdowns: upper arms at the sides, a little ahead of vertical against the lean
    for (const id of [704, 715]) expect(elevation(id)[1]).toBeLessThan(30)
    // overhead: past 160 deg against the trunk (research ~170)
    for (const id of [705, 716]) expect(elevation(id)[0]).toBeGreaterThan(160)
    // skull crusher: ~110 (research 90-110)
    const lying = elevation(706)
    expect(lying[0]).toBeGreaterThan(100)
    expect(lying[1]).toBeLessThan(120)
    // kickback: upper arm level with the floor, along the trunk
    const b = get(717)
    const f = fk(skel, frameQ(b, 0))
    const h = sub(segPos(skel, f, 'forearm_r'), segPos(skel, f, 'humerus_r'))
    expect(Math.abs(90 - angleBetween(h, [0, -1, 0]) * RAD)).toBeLessThan(12)
  })

  it.each([...baked.keys()])('%s: hands stay on the load and planted contacts hold', (id) => {
    const b = get(id)
    const first = b.contacts.map((c) => sitePos(skel, fk(skel, frameQ(b, 0)), c.site))
    for (let i = 0; i < b.frames; i += 3) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      b.contacts.forEach((c, k) => {
        const p = sitePos(skel, f, c.site)
        if ('implement' in c.target) {
          const { implement, grip } = c.target
          const j = b.implements.findIndex((s) => s.id === implement)
          if (c.kind === 'grip') expect(dist(p, siteWorld(b.implements[j], impl[j], grip).pos)).toBeLessThan(0.005)
          else expect(dist(p, first[k])).toBeLessThan(0.005)
        } else expect(dist(p, c.target.world)).toBeLessThan(0.005)
      })
    }
  })

  it.each([...baked.keys()])('%s: the loop closes without a jump', (id) => {
    const b = get(id)
    const n = b.frames
    for (const d of skel.dofs) {
      const x = Array.from({ length: n }, (_, i) => b.q[i * b.nDof + d.index])
      const step = Math.max(...x.slice(1).map((v, i) => Math.abs(v - x[i])))
      expect(Math.abs(x[0] - x[n - 1])).toBeLessThanOrEqual(1.5 * step + (d.unit === 'm' ? 1e-4 : 0.01))
    }
  })

  it('the rope spreads at lockout, the fists meet at the stretch', () => {
    const b = get(704)
    const gap = (u: number) => {
      const f = fk(skel, frameQ(b, at(b, u)))
      return dist(sitePos(skel, f, 'grip_l'), sitePos(skel, f, 'grip_r'))
    }
    expect(gap(0) - gap(0.6)).toBeGreaterThan(0.08)
  })

  it('pushdowns: the body stands still (the approved curls sway at most ~25 mm)', () => {
    for (const [id, most] of [[704, 0.005], [715, 0.005]] as const) {
      const b = get(id)
      const z = Array.from({ length: b.frames }, (_, i) => segPos(skel, fk(skel, frameQ(b, i)), 'head')[2])
      expect(Math.max(...z) - Math.min(...z)).toBeLessThan(most)
    }
  })

  it('straight bar: the elbows do not turn out as the bar rises (humeral rotation takes up the hand spacing)', () => {
    const b = get(715)
    const out = Array.from({ length: b.frames }, (_, i) => {
      const h = humerus(b, i)
      return Math.asin(h[0] / Math.hypot(...h)) * RAD
    })
    expect(Math.max(...out) - Math.min(...out)).toBeLessThan(1)
    expect(dof(b, 0, 'elbow_*.flex')).toBeLessThan(5)
    let pro = -Infinity
    for (let i = 0; i < b.frames; i++) pro = Math.max(pro, frameQ(b, i)[skel.dof['forearm_l.pro']])
    expect(pro).toBeLessThan(84)
  })

  it('straight bar: the bar rises to chest height, not to the collarbones (cue 4)', () => {
    const b = get(715)
    const u = (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] / 2) / (b.tempo[0] + b.tempo[1] + b.tempo[2] + b.tempo[3])
    const f = fk(skel, frameQ(b, at(b, u)))
    const grip = sitePos(skel, f, 'grip_l')[1]
    expect(Math.abs(grip - sitePos(skel, f, 'sternum')[1])).toBeLessThan(0.04)
    expect(segPos(skel, f, 'humerus_l')[1] - grip).toBeGreaterThan(0.09)
  })

  it('seated overhead: the dumbbell lowers to neck level behind the head (cue 3)', () => {
    const b = get(716)
    const u = (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] / 2) / (b.tempo[0] + b.tempo[1] + b.tempo[2] + b.tempo[3])
    const i = at(b, u)
    const f = fk(skel, frameQ(b, i))
    const k = b.implements.findIndex((s) => s.id === 'db')
    const db = frameImplements(b, i)[k].pos
    const head = segPos(skel, f, 'head'), neck = segPos(skel, f, 'neck1')
    expect(db[2]).toBeLessThan(head[2])
    expect(db[1]).toBeLessThan(head[1] + 0.05)
    expect(db[1]).toBeGreaterThan(neck[1] - 0.05)
    // the backrest stops the elbows short of full flexion, so the cue names the depth the loop shows
    expect(dof(b, u, 'elbow_*.flex')).toBeLessThan(140)
    const rec = JSON.parse(readFileSync(new URL('../../../data/exercises/716-seated-overhead-dumbbell-extension.json', import.meta.url), 'utf8'))
    expect(rec.cues.join(' ')).not.toMatch(/fully bent/)
  })

  it('seated overhead: both hands on the one dumbbell, cupping the top head', () => {
    const b = get(716)
    expect(b.contacts.filter((c) => c.kind === 'grip').map((c) => 'implement' in c.target && `${c.target.implement}:${c.target.grip}`)).toEqual(['db:cup_l', 'db:cup_r'])
  })

  it('kickback works one arm: the free hand braces on the bench, one foot planted', () => {
    const b = get(717)
    expect(b.symmetric).toBe(false)
    expect(b.contacts.find((c) => c.site === 'grip_l')?.kind).toBe('support')
    expect(b.contacts.filter((c) => c.kind === 'planted').map((c) => c.site)).toEqual(['heel_r', 'ball_r'])
    // the free arm does not move
    const [lo, hi] = range(b, 'elbow_l.flex')
    expect(hi - lo).toBeLessThan(0.01)
  })

  it('unsupported variants throw', () => {
    const p = parseParams('triceps-extension', { implement: 'cable', attachment: 'v_bar', posture: 'standing', shoulderFlexion: 0 })
    expect(() => getTemplate('triceps-extension').setup(p, skel)).toThrow(/variant not implemented yet/)
  })
})

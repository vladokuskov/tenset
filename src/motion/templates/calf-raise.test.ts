import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts, type Capsule } from '../collide.ts'
import { fk, localToWorld, sitePos, type FK } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, sub, type V3 } from '../math.ts'
import { zeroQ } from '../skeleton.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('calf-raise')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('calf-raise'), parseParams('calf-raise', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, i: number, name: string) => frameQ(b, i)[skel.dof[name]]
const TOP = 0, STRETCH = 0.625
/** the loaded (or working) side */
const side = (id: number) => (id === 604 || id === 606 ? 'r' : 'l')

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

/**
 * The foot as the toes really sit: the rigid forefoot capsule split at the metatarsophalangeal joint, its distal part
 * turned with the toes segment (the QA gate keeps the whole capsule rigid with the foot)
 */
function toeAwareFoot(f: FK, s: 'l' | 'r'): Capsule[] {
  const caps = skel.data.capsules
  const mtp = skel.data.segments[`toes_${s}`].offset as V3
  const fore = caps[`forefoot_${s}`], rear = caps[`rearfoot_${s}`]
  const w = (seg: string, v: V3) => localToWorld(skel, f, seg, v)
  const joint: V3 = [fore.b[0], fore.a[1], mtp[2]]
  const base = { region: `foot_${s}`, segment: `foot_${s}` }
  return [
    { ...base, name: 'rear', a: w(`foot_${s}`, rear.a), b: w(`foot_${s}`, rear.b), r: rear.r },
    { ...base, name: 'fore', a: w(`foot_${s}`, fore.a), b: w(`foot_${s}`, joint), r: fore.r },
    { ...base, name: 'toes', a: w(`toes_${s}`, sub(joint, mtp)), b: w(`toes_${s}`, sub(fore.b, mtp)), r: fore.r },
  ]
}

describe('calf-raise template', () => {
  it('covers every family record', () => {
    expect([...baked.keys()].sort()).toEqual([601, 602, 603, 604, 605, 606, 607, 610, 612])
  })

  it.each([...baked.keys()])('%s: finite, contacts held, the loop closes', (id) => {
    const b = get(id)
    expect(b.q.every(Number.isFinite)).toBe(true)
    for (let i = 0; i < b.frames; i++) expect(contactError(b, i)).toBeLessThan(0.005)
    const q0 = frameQ(b, 0), q1 = frameQ(b, b.frames - 1)
    for (const d of skel.dofs) if (d.unit !== 'm') expect(Math.abs(q0[d.index] - q1[d.index]), d.name).toBeLessThan(1.5)
  })

  it('heel raises: full ankle range, ~10-25 deg stretch below the support to 30-45 deg plantarflexion', () => {
    for (const id of [601, 602, 604, 605, 606, 607, 612]) {
      const b = get(id), s = side(id)
      const stretch = dof(b, at(b, STRETCH), `ankle_${s}.df`), top = dof(b, at(b, TOP), `ankle_${s}.df`)
      expect(stretch, `${id} stretch`).toBeGreaterThanOrEqual(10)
      expect(stretch, `${id} stretch`).toBeLessThanOrEqual(25)
      expect(-top, `${id} top`).toBeGreaterThanOrEqual(30)
      expect(-top, `${id} top`).toBeLessThanOrEqual(45)
      // the heel hangs below the ball at the stretch and rises well above it at the top
      const heelDrop = (u: number) => {
        const f = fk(skel, frameQ(b, at(b, u)))
        return sitePos(skel, f, `ball_${s}`)[1] - sitePos(skel, f, `heel_${s}`)[1]
      }
      if (id !== 605) {
        // with a bar on the back the body leans less over the ball, so the heel drops a little less
        expect(heelDrop(STRETCH), `${id} heel below the edge`).toBeGreaterThan(id === 607 || id === 612 ? 0.035 : 0.04)
        expect(heelDrop(TOP), `${id} heel raised`).toBeLessThan(-0.06)
      }
    }
  })

  it('knees straight on standing raises and the leg press, ~90 deg seated', () => {
    for (const id of [601, 604, 605, 606, 607, 612]) {
      const b = get(id), s = side(id)
      for (let i = 0; i < b.frames; i += 3) {
        expect(dof(b, i, `knee_${s}.flex`)).toBeGreaterThanOrEqual(0)
        expect(dof(b, i, `knee_${s}.flex`)).toBeLessThan(6)
      }
    }
    for (const id of [602, 610]) {
      const seated = get(id)
      for (let i = 0; i < seated.frames; i += 3) expect(Math.abs(dof(seated, i, 'knee_l.flex') - 90)).toBeLessThan(8)
    }
  })

  it('tibialis raise: heels planted, back on the wall, toes lift ~30 deg about the heels', () => {
    const b = get(603)
    const flat = dof(b, at(b, STRETCH), 'ankle_l.df'), up = dof(b, at(b, TOP), 'ankle_l.df')
    expect(up - flat).toBeGreaterThan(20)
    expect(up - flat).toBeLessThan(35)
    const wall = b.implements.findIndex((s) => s.id === 'wall')
    for (let i = 0; i < b.frames; i += 4) {
      const [panel] = placeParts(b.implements[wall], frameImplements(b, i)[wall])
      const trunk = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region === 'trunk')
      const gap = Math.min(...trunk.map((c) => capsuleSolidClearance(c, panel)))
      expect(gap).toBeLessThan(0.005)
      expect(gap).toBeGreaterThan(-0.015)
    }
  })

  it('the toe-aware foot rests on the step or plate within the pad tolerance (the rigid capsule dips further)', () => {
    const f0 = fk(skel, zeroQ(skel))
    // the toes segment starts at the joint with the foot's rest orientation
    expect(dist(localToWorld(skel, f0, 'foot_l', skel.data.segments.toes_l.offset as V3), f0.pos[skel.seg.toes_l])).toBeLessThan(1e-9)
    for (const [id, support] of [[604, 'box'], [606, 'box'], [605, 'sled'], [607, 'box'], [612, 'box']] as const) {
      const b = get(id), s = side(id)
      const k = b.implements.findIndex((x) => x.id === support)
      let worst = Infinity
      for (let i = 0; i < b.frames; i++) {
        const solids = placeParts(b.implements[k], frameImplements(b, i)[k])
        const feet = toeAwareFoot(fk(skel, frameQ(b, i)), s)
        worst = Math.min(worst, ...feet.flatMap((c) => solids.map((sd) => capsuleSolidClearance(c, sd))))
      }
      expect(worst, `${id}`).toBeGreaterThan(-0.015)
    }
  })

  it('single-leg raises keep the centre of mass over the ball and the free hand on the wall', () => {
    for (const id of [604, 606]) {
      const b = get(id)
      expect(b.balance?.over).toEqual({ implement: 'box', sites: ['ball'] })
      expect(b.contacts.some((c) => c.site === 'grip_l' && 'implement' in c.target && c.target.implement === 'wall')).toBe(true)
    }
  })

  it('bar on the back, both forefeet on the step: free, the centre of mass with the bar over the balls; Smith, on the rail line', () => {
    const free = get(612), smith = get(607)
    expect(free.balance?.over).toEqual({ implement: 'box', sites: ['ball'] })
    expect(smith.balance).toBeUndefined()
    expect(smith.implements.some((s) => s.id === 'smith')).toBe(true)
    for (const b of [free, smith]) {
      const k = b.implements.findIndex((s) => s.id === 'bar')
      const z0 = frameImplements(b, 0)[k].pos[2]
      for (let i = 0; i < b.frames; i += 3) {
        const f = fk(skel, frameQ(b, i))
        const bar = frameImplements(b, i)[k].pos
        // on the upper back, above the shoulder joints and behind the neck
        expect(bar[1]).toBeGreaterThan(f.pos[skel.seg.humerus_l][1])
        expect(bar[2]).toBeLessThan(f.pos[skel.seg.neck1][2])
        // the Smith bar stays on its rail line
        if (b === smith) expect(Math.abs(bar[2] - z0)).toBeLessThan(0.001)
      }
    }
  })

  it('seated with dumbbells: feet flat at the bottom, heels high at the top, the dumbbells upright on the lower thighs', () => {
    const b = get(610)
    expect(dof(b, at(b, STRETCH), 'ankle_l.df')).toBeCloseTo(0, 0)
    expect(-dof(b, at(b, TOP), 'ankle_l.df')).toBeGreaterThanOrEqual(30)
    const flat = fk(skel, frameQ(b, at(b, STRETCH)))
    for (const s of ['l', 'r']) expect(Math.abs(sitePos(skel, flat, `heel_${s}`)[1] - sitePos(skel, flat, `ball_${s}`)[1])).toBeLessThan(0.01)
    const raised = fk(skel, frameQ(b, at(b, TOP)))
    expect(sitePos(skel, raised, 'heel_l')[1] - sitePos(skel, raised, 'ball_l')[1]).toBeGreaterThan(0.06)
    for (const s of ['l', 'r'] as const) {
      const k = b.implements.findIndex((x) => x.id === `db_${s}`)
      for (let i = 0; i < b.frames; i += 5) {
        const solids = placeParts(b.implements[k], frameImplements(b, i)[k])
        const thigh = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region === `thigh_${s}`)
        const gap = Math.min(...thigh.flatMap((c) => solids.map((sd) => capsuleSolidClearance(c, sd))))
        expect(gap).toBeGreaterThan(-0.008)
        expect(gap).toBeLessThan(0.003)
      }
    }
  })

  it('throws for variants it does not draw', () => {
    const t = getTemplate('calf-raise')
    for (const raw of [{ implement: 'smith', stance: 'single_leg' }, { implement: 'barbell', platform: 'floor' }, { implement: 'dumbbell', posture: 'seated', platform: 'step' }, { implement: 'bodyweight', direction: 'dorsiflexion', platform: 'step', support: 'none' }]) {
      expect(() => t.setup(parseParams('calf-raise', raw), skel)).toThrow(/variant not implemented yet/)
    }
  })
})

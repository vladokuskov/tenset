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
    expect([...baked.keys()].sort()).toEqual([601, 602, 603, 604, 605, 606])
  })

  it.each([...baked.keys()])('%s: finite, contacts held, the loop closes', (id) => {
    const b = get(id)
    expect(b.q.every(Number.isFinite)).toBe(true)
    for (let i = 0; i < b.frames; i++) expect(contactError(b, i)).toBeLessThan(0.005)
    const q0 = frameQ(b, 0), q1 = frameQ(b, b.frames - 1)
    for (const d of skel.dofs) if (d.unit !== 'm') expect(Math.abs(q0[d.index] - q1[d.index]), d.name).toBeLessThan(1.5)
  })

  it('heel raises: full ankle range, ~10-25 deg stretch below the support to 30-45 deg plantarflexion', () => {
    for (const id of [601, 602, 604, 605, 606]) {
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
        expect(heelDrop(STRETCH), `${id} heel below the edge`).toBeGreaterThan(0.04)
        expect(heelDrop(TOP), `${id} heel raised`).toBeLessThan(-0.06)
      }
    }
  })

  it('knees straight on standing raises and the leg press, ~90 deg seated', () => {
    for (const id of [601, 604, 605, 606]) {
      const b = get(id), s = side(id)
      for (let i = 0; i < b.frames; i += 3) {
        expect(dof(b, i, `knee_${s}.flex`)).toBeGreaterThanOrEqual(0)
        expect(dof(b, i, `knee_${s}.flex`)).toBeLessThan(6)
      }
    }
    const seated = get(602)
    for (let i = 0; i < seated.frames; i += 3) expect(Math.abs(dof(seated, i, 'knee_l.flex') - 90)).toBeLessThan(8)
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
    for (const [id, support] of [[604, 'box'], [606, 'box'], [605, 'sled']] as const) {
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

  it('throws for variants it does not draw', () => {
    const t = getTemplate('calf-raise')
    for (const raw of [{ implement: 'smith' }, { implement: 'barbell', stance: 'hip' }, { implement: 'bodyweight', direction: 'dorsiflexion', platform: 'step', support: 'none' }]) {
      expect(() => t.setup(parseParams('calf-raise', raw), skel)).toThrow(/variant not implemented yet/)
    }
  })
})

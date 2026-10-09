import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts, segmentDistance } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { cableForce } from '../implements.ts'
import { dist } from '../math.ts'
import { FLOOR_MAT } from '../implements/shared.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { contactError, frameAt, seamRatio } from './core/checks.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('crunch')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('crunch'), parseParams('crunch', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const dof = (b: Baked, i: number, name: string) => frameQ(b, i)[skel.dof[name]]
const TOP = 0, BOTTOM = 0.625

/** thorax2 pitch from the horizontal (floor) or vertical (kneeling), deg, towards flexion */
function spineFlex(b: Baked, i: number) {
  return dof(b, i, 'lumbar.flex') + dof(b, i, 'thorax.flex')
}

describe('crunch template', () => {
  it('covers every family record', () => {
    expect([...baked.keys()].sort()).toEqual([801, 805, 818, 834, 838, 840])
  })

  it.each([801, 805])('%s: contacts held, loop seam closes, flexion comes from the spine', (id) => {
    const b = get(id)
    for (let i = 0; i < b.frames; i++) expect(contactError(skel, b, i)).toBeLessThan(0.005)
    expect(seamRatio(skel, b)).toBeLessThan(1.5)
    // the curl is spinal: thorax flexes most, the hips hold their angle
    const top = frameAt(b, TOP), bottom = frameAt(b, BOTTOM)
    expect(dof(b, top, 'thorax.flex') - dof(b, bottom, 'thorax.flex')).toBeGreaterThan(15)
    expect(Math.abs(dof(b, top, 'hip_l.flex') - dof(b, bottom, 'hip_l.flex'))).toBeLessThan(6)
  })

  it('805 floor crunch: shoulder blades ~30 deg off the mat, pelvis down, chin tucked, feet planted', () => {
    const b = get(805)
    const top = frameAt(b, TOP), bottom = frameAt(b, BOTTOM)
    // upper trunk rise (research: thoracolumbar 0 -> ~30 deg) = spinal flexion + posterior pelvic tilt
    const rise = spineFlex(b, top) - spineFlex(b, bottom) + (dof(b, bottom, 'pelvis.tilt') - dof(b, top, 'pelvis.tilt'))
    expect(rise).toBeGreaterThan(25)
    expect(rise).toBeLessThan(40)
    expect(dof(b, top, 'thorax.flex')).toBeGreaterThan(dof(b, top, 'lumbar.flex'))
    expect(dof(b, top, 'knee_l.flex')).toBeCloseTo(90, -1)
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const y = segPos(skel, f, 'pelvis')[1]
      lo = Math.min(lo, y)
      hi = Math.max(hi, y)
      // resting parts sink at most a little into the mat, nothing goes through the floor
      for (const c of bodyCapsules(skel, f)) expect(Math.min(c.a[1], c.b[1]) - c.r, c.name).toBeGreaterThan(-0.005)
    }
    expect(hi - lo).toBeLessThan(0.01)
    // at the top the head is off the mat with the neck flexed a little more than the thorax carries it
    const head = bodyCapsules(skel, fk(skel, frameQ(b, top))).filter((c) => c.region === 'head')
    expect(Math.min(...head.map((c) => Math.min(c.a[1], c.b[1]) - c.r))).toBeGreaterThan(FLOOR_MAT.thick + 0.08)
    expect(dof(b, top, 'neck.flex')).toBeGreaterThan(8)
  })

  it('801 kneeling cable crunch: hips still over the knees, the spine curls ~60 deg, rope and cable clear the head', () => {
    const b = get(801)
    const top = frameAt(b, TOP), bottom = frameAt(b, BOTTOM)
    expect(spineFlex(b, top) - spineFlex(b, bottom)).toBeGreaterThan(50)
    const k = b.implements.findIndex((s) => s.id === 'handle')
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      expect(q[skel.dof['pelvis.ty']]).toBeCloseTo(frameQ(b, 0)[skel.dof['pelvis.ty']], 6)
      const f = fk(skel, q)
      // thighs near vertical: hips over the knees
      const hip = segPos(skel, f, 'femur_l'), knee = segPos(skel, f, 'tibia_l')
      expect(Math.abs(hip[2] - knee[2])).toBeLessThan(0.08)
      const head = bodyCapsules(skel, f).filter((c) => c.region === 'head')
      const pose = frameImplements(b, i)[k]
      for (const s of placeParts(b.implements[k], pose)) for (const c of head) expect(capsuleSolidClearance(c, s)).toBeGreaterThan(-0.003)
      const { at } = cableForce(b.cables![0], pose)
      for (const c of head) expect(segmentDistance(c.a, c.b, at, b.cables![0].pulley).d - c.r).toBeGreaterThan(0)
    }
  })

  it('801: fists beside the temples clear of the brow, knees and toes well inside the mat', () => {
    const b = get(801)
    const m = b.implements.findIndex((s) => s.id === 'mat')
    const box = b.implements[m].parts[0] as Extract<(typeof b.implements)[number]['parts'][number], { shape: 'box' }>
    for (let i = 0; i < b.frames; i++) {
      const caps = bodyCapsules(skel, fk(skel, frameQ(b, i)))
      const head = caps.filter((c) => c.region === 'head')
      // the closed fingers reach ~1-2 cm past the fist capsule: at 15 mm their tips showed through the brow
      for (const side of ['l', 'r']) for (const h of caps.filter((c) => c.region === `hand_${side}`)) for (const c of head) expect(capsuleClearance(h, c)).toBeGreaterThan(0.025)
      const z = frameImplements(b, i)[m].pos[2]
      const front = z + box.size[2] / 2, back = z - box.size[2] / 2
      const legs = caps.filter((c) => c.region.startsWith('shank_') || c.region.startsWith('foot_'))
      expect(front - Math.max(...legs.map((c) => Math.max(c.a[2], c.b[2]) + c.r))).toBeGreaterThan(0.05)
      expect(Math.min(...legs.map((c) => Math.min(c.a[2], c.b[2]) - c.r)) - back).toBeGreaterThan(0.02)
    }
  })

  it('unsupported variants say so', () => {
    const t = getTemplate('crunch')
    expect(() => t.setup(parseParams('crunch', { implement: 'machine', posture: 'kneeling' }), skel)).toThrow(/variant not implemented yet/)
  })

  it.each([818, 834, 838, 840])('%s: contacts held, the loop closes', (id) => {
    const b = get(id)
    for (let i = 0; i < b.frames; i++) expect(contactError(skel, b, i)).toBeLessThan(0.005)
    expect(seamRatio(skel, b)).toBeLessThan(1.5)
  })

  it.each([838, 818])('%s sit-up: the spine curls first, then the trunk rises from the hips, the seat stays down', (id) => {
    const b = get(id)
    const top = frameAt(b, TOP), bottom = frameAt(b, BOTTOM)
    // the trunk turns ~60 deg up off the support (pelvis tilt) on top of the curl
    expect(dof(b, top, 'pelvis.tilt') - dof(b, bottom, 'pelvis.tilt')).toBeGreaterThan(18)
    expect(spineFlex(b, top) - spineFlex(b, bottom)).toBeGreaterThan(35)
    expect(dof(b, top, 'hip_l.flex') - dof(b, bottom, 'hip_l.flex')).toBeGreaterThan(15)
    // halfway up the spine has done most of its curl
    const mid = frameAt(b, 0.85)
    expect(spineFlex(b, mid) - spineFlex(b, bottom)).toBeGreaterThan(0.5 * (spineFlex(b, top) - spineFlex(b, bottom)))
  })

  it('818 decline sit-up: on the board, head end low, the rollers over the front of the ankles', () => {
    const b = get(818)
    const k = b.implements.findIndex((s) => s.kind === 'decline_board')
    expect(k).toBeGreaterThanOrEqual(0)
    const f = fk(skel, frameQ(b, frameAt(b, BOTTOM)))
    expect(segPos(skel, f, 'head')[1]).toBeLessThan(segPos(skel, f, 'femur_l')[1] - 0.15)
    const roller = b.implements[k].sites.roller.pos
    for (const s of ['l', 'r']) expect(dist(segPos(skel, f, `foot_${s}`), [Math.sign(segPos(skel, f, `foot_${s}`)[0]) * 0.11, roller[1], roller[2]])).toBeLessThan(0.2)
  })

  it('834 weighted crunch: the plate rides on the chest, held by its rim, through the curl', () => {
    const b = get(834)
    const k = b.implements.findIndex((s) => s.id === 'plate')
    for (let i = 0; i < b.frames; i++) expect(dist(frameImplements(b, i)[k].pos, sitePos(skel, fk(skel, frameQ(b, i)), 'sternum'))).toBeLessThan(0.08)
    expect(spineFlex(b, frameAt(b, TOP)) - spineFlex(b, frameAt(b, BOTTOM))).toBeGreaterThan(15)
  })

  it('840 standing cable crunch: back to the stack, the ribs curl down with soft knees, the curl draws the cable out', () => {
    const b = get(840)
    const top = frameAt(b, TOP), bottom = frameAt(b, BOTTOM)
    expect(spineFlex(b, top) - spineFlex(b, bottom)).toBeGreaterThan(40)
    expect(dof(b, top, 'knee_l.flex')).toBeLessThan(30)
    const pulley = b.cables![0].pulley
    const k = b.implements.findIndex((s) => s.id === 'handle')
    expect(pulley[2]).toBeLessThan(segPos(skel, fk(skel, frameQ(b, bottom)), 'head')[2])
    expect(dist(frameImplements(b, top)[k].pos, pulley)).toBeGreaterThan(dist(frameImplements(b, bottom)[k].pos, pulley) + 0.1)
  })
})

import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { kettlebellDims, PLATE, TRAP_BAR } from '../implements/free-weights.ts'
import { PLATE_20_RADIUS, siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { BOTTOM_HIP, KB, PINS, SPINE, SPLIT, TOP_HIP, TOP_KNEE, TRAP } from './hinge.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('hinge')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('hinge'), parseParams('hinge', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]
/** the working (stance) side: the single-leg and B-stance records stand on (lead with) their right leg */
const stance = (b: Baked) => (b.params.stance === 'single_leg' || b.params.stance === 'split' ? (b.params.side === 'left' ? 'l' : 'r') : 'l')
const legClear = (b: Baked, i: number, id: string) => {
  const f = fk(skel, frameQ(b, i))
  const spec = b.implements.find((s) => s.id === id)!
  const solids = placeParts(spec, frameImplements(b, i).find((p) => p.id === id)!)
  return Math.min(...bodyCapsules(skel, f).filter((c) => /^(thigh|shank)_/.test(c.region)).flatMap((c) => solids.map((sd) => capsuleSolidClearance(c, sd))))
}

describe('hinge template', () => {
  it('covers every hinge record in the family', () => {
    expect([...baked.keys()].sort()).toEqual([501, 508, 509, 510, 513, 516, 517, 519, 520, 521, 522, 523, 524, 525, 542])
  })

  it.each([...baked.keys()])('%i: feet planted, hands on the load, finite frames, seamless loop', (id) => {
    const b = get(id)
    expect(b.q.every(Number.isFinite)).toBe(true)
    const first = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i += 3) {
      const f = fk(skel, frameQ(b, i))
      const poses = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind === 'planted') expect(dist(sitePos(skel, f, c.site), sitePos(skel, first, c.site))).toBeLessThan(0.002)
        else if ('implement' in c.target) {
          const { implement, grip } = c.target
          const spec = b.implements.find((s) => s.id === implement)!
          expect(dist(sitePos(skel, f, c.site), siteWorld(spec, poses.find((p) => p.id === implement)!, grip).pos)).toBeLessThan(0.005)
        }
      }
    }
    // the loop is cut in the top pause: the last frame is next to the first
    const a = frameQ(b, 0), z = frameQ(b, b.frames - 1)
    for (const d of skel.dofs) if (d.unit === 'deg') expect(Math.abs(a[d.index] - z[d.index])).toBeLessThan(1)
  })

  it.each([...baked.keys()])('%i: lockout at hip and knee ~0 with no hyperextension, spine neutral through the rep', (id) => {
    const b = get(id)
    const s = stance(b)
    expect(dof(b, 0, `hip_${s}.flex`)).toBeCloseTo(TOP_HIP, 0)
    // the sumo kettlebell keeps the knees soft at the top
    expect(dof(b, 0, `knee_${s}.flex`)).toBeCloseTo(id === 520 ? KB.sumoTopKnee : TOP_KNEE, 0)
    for (let i = 0; i < b.frames; i += 4) {
      const q = frameQ(b, i)
      expect(q[skel.dof[`hip_${s}.flex`]]).toBeGreaterThan(-5)
      expect(Math.abs(q[skel.dof['lumbar.flex']])).toBeLessThanOrEqual(SPINE.lumbar + 0.01)
      expect(Math.abs(q[skel.dof['thorax.flex']])).toBeLessThanOrEqual(SPINE.thorax + 0.01)
    }
  })

  it('RDLs: knees held at ~15-25 deg while the hips flex to ~70-90 (research range)', () => {
    for (const id of [501, 509, 510, 519, 524, 542]) {
      const b = get(id)
      const s = stance(b)
      expect(dof(b, 0.625, `knee_${s}.flex`)).toBeGreaterThanOrEqual(15)
      expect(dof(b, 0.625, `knee_${s}.flex`)).toBeLessThanOrEqual(25)
      const hip = dof(b, 0.625, `hip_${s}.flex`)
      expect(hip).toBeGreaterThanOrEqual(70)
      expect(hip).toBeLessThanOrEqual(90)
    }
    expect(dof(get(501), 0.625, 'hip_l.flex')).toBeCloseTo(BOTTOM_HIP.bar, 0)
  })

  it('barbell: bar over the midfoot all rep and close to the legs', () => {
    for (const id of [501, 508]) {
      const b = get(id)
      for (let i = 0; i < b.frames; i += 3) {
        const f = fk(skel, frameQ(b, i))
        const mid = (sitePos(skel, f, 'midfoot_l')[2] + sitePos(skel, f, 'midfoot_r')[2]) / 2
        const bar = frameImplements(b, i)[0].pos
        expect(Math.abs(bar[2] - mid)).toBeLessThan(0.025)
        // the bar rides the front of the legs (the floor pull a few cm off where the knees stick out, never in them)
        const legs = bodyCapsules(skel, f).filter((c) => /^(thigh|shank)_/.test(c.region))
        const gap = Math.min(...legs.map((c) => capsuleClearance(c, { a: [-0.655, bar[1], bar[2]], b: [0.655, bar[1], bar[2]], r: 0.014 })))
        expect(gap).toBeGreaterThan(-0.003)
        expect(gap).toBeLessThan(id === 501 ? 0.012 : 0.035)
      }
    }
  })

  it('conventional deadlift starts from the floor: plates on the floor, hips bent more than the knees', () => {
    const b = get(508)
    const bottom = frameImplements(b, at(b, 0.625))[0].pos
    expect(bottom[1]).toBeCloseTo(PLATE_20_RADIUS, 2)
    expect(dof(b, 0.625, 'hip_l.flex')).toBeGreaterThan(dof(b, 0.625, 'knee_l.flex') + 30)
    expect(dof(b, 0.625, 'knee_l.flex')).toBeGreaterThan(50)
  })

  it('sumo deadlift: wide stance, toes out, grip inside the knees, plates on the floor, trunk more upright than conventional', () => {
    const b = get(521), conv = get(508)
    const bottom = frameImplements(b, at(b, 0.625))[0].pos
    expect(bottom[1]).toBeCloseTo(PLATE_20_RADIUS, 2)
    const f = fk(skel, frameQ(b, at(b, 0.625)))
    // hands inside the knees
    expect(sitePos(skel, f, 'grip_l')[0]).toBeLessThan(segPos(skel, f, 'tibia_l')[0])
    // feet wider than the conventional pull's
    const width = (x: Baked) => sitePos(skel, fk(skel, frameQ(x, 0)), 'heel_l')[0]
    expect(width(b)).toBeGreaterThan(width(conv) + 0.1)
    expect(dof(b, 0.625, 'pelvis.tilt')).toBeLessThan(dof(conv, 0.625, 'pelvis.tilt') - 5)
    expect(dof(b, 0.625, 'knee_l.flex')).toBeGreaterThan(dof(conv, 0.625, 'knee_l.flex'))
    // a sumo floor position: knees ~90-100, hips low, trunk ~45-50 deg from vertical
    expect(dof(b, 0.625, 'knee_l.flex')).toBeGreaterThan(88)
    const hip = segPos(skel, f, 'femur_l'), neck = segPos(skel, f, 'neck1')
    expect(hip[1]).toBeLessThan(0.66)
    const lean = Math.atan2(Math.abs(neck[2] - hip[2]), neck[1] - hip[1]) / (Math.PI / 180)
    expect(lean).toBeGreaterThan(42)
    expect(lean).toBeLessThan(54)
  })

  it('stiff-leg deadlift: knees held at the param from the floor, the hips alone take the bar down to the plates', () => {
    const b = get(525)
    const bottom = frameImplements(b, at(b, 0.625))[0].pos
    expect(bottom[1]).toBeCloseTo(PLATE_20_RADIUS, 2)
    expect(dof(b, 0.625, 'knee_l.flex')).toBeCloseTo(b.params.kneeAngle as number, 0)
    for (let i = 0; i < b.frames; i += 3) expect(frameQ(b, i)[skel.dof['knee_l.flex']]).toBeLessThanOrEqual((b.params.kneeAngle as number) + 0.01)
    expect(dof(b, 0.625, 'hip_l.flex')).toBeGreaterThan(95)
  })

  it('single leg: the free leg swings up in line with the trunk as a lever and never touches down', () => {
    const b = get(510)
    const q = frameQ(b, at(b, 0.625))
    const trunk = q[skel.dof['lumbar.flex']] + q[skel.dof['thorax.flex']]
    expect(q[skel.dof['hip_l.flex']]).toBeCloseTo(-trunk, 0)
    expect(q[skel.dof['knee_l.flex']]).toBeLessThan(10)
    for (let i = 0; i < b.frames; i += 3) expect(sitePos(skel, fk(skel, frameQ(b, i)), 'toe_l')[1]).toBeGreaterThan(0.05)
  })

  it('pull-through: facing away from a low pulley, rope pulled back between the legs', () => {
    const b = get(513)
    const pulley = b.cables![0].pulley
    const f = fk(skel, frameQ(b, at(b, 0.625)))
    expect(pulley[1]).toBeLessThan(0.2)
    expect(pulley[2]).toBeLessThan(sitePos(skel, f, 'heel_l')[2] - 0.3)
    const rope = frameImplements(b, at(b, 0.625))[0].pos
    expect(Math.abs(rope[0])).toBeLessThan(0.01)
    expect(rope[2]).toBeLessThan(segPos(skel, f, 'tibia_l')[2])
    // fists side by side on the rope ends, inside the knees at the bottom
    const grip = sitePos(skel, f, 'grip_l')
    expect(grip[0]).toBeLessThan(0.1)
    expect(grip[0]).toBeLessThan(segPos(skel, f, 'tibia_l')[0] - 0.05)
  })

  it('kettlebell RDL: both hands on the handle, the bell close in front of the legs (a hand off the thighs at lockout)', () => {
    const b = get(519)
    for (let i = 0; i < b.frames; i += 3) {
      const gap = legClear(b, i, 'kb')
      expect(gap).toBeGreaterThan(-0.003)
      // the converging arms meet the chest before the bell reaches the thighs when standing tall
      expect(gap).toBeLessThan(0.13)
    }
    // at the bottom the straight arms rest on the knees with the bell just below them
    expect(legClear(b, at(b, 0.625), 'kb')).toBeLessThan(0.07)
    const f = fk(skel, frameQ(b, 0))
    expect(Math.abs(sitePos(skel, f, 'grip_l')[0] - sitePos(skel, f, 'grip_r')[0])).toBeLessThan(0.12)
  })

  it('kettlebell sumo: wide stance, the bell stands on the floor between the heels at the bottom, knees bent past 80', () => {
    const b = get(520)
    const pose = frameImplements(b, at(b, 0.625)).find((p) => p.id === 'kb')!
    expect(pose.pos[1]).toBeCloseTo(kettlebellDims(b.implements.find((s) => s.id === 'kb')!.mass).base, 2)
    expect(Math.abs(pose.pos[0])).toBeLessThan(0.01)
    const f = fk(skel, frameQ(b, at(b, 0.625)))
    expect(Math.abs(pose.pos[2] - (sitePos(skel, f, 'midfoot_l')[2] + sitePos(skel, f, 'midfoot_r')[2]) / 2)).toBeLessThan(0.03)
    expect(dof(b, 0.625, 'knee_l.flex')).toBeGreaterThan(80)
    for (let i = 0; i < b.frames; i += 3) expect(legClear(b, i, 'kb')).toBeGreaterThan(-0.003)
  })

  it('good morning: the bar rides the upper back (high-bar site), knees soft, the trunk hinges to ~80 deg hip flexion', () => {
    const b = get(522)
    for (const u of [0, 0.3, 0.625]) {
      const f = fk(skel, frameQ(b, at(b, u)))
      const site = sitePos(skel, f, 'back_high')
      expect(dist(frameImplements(b, at(b, u))[0].pos, [0, site[1], site[2]])).toBeLessThan(0.003)
    }
    expect(dof(b, 0.625, 'hip_l.flex')).toBeCloseTo(BOTTOM_HIP.back, 0)
    expect(dof(b, 0.625, 'knee_l.flex')).toBeCloseTo(b.params.kneeAngle as number, 0)
  })

  it('rack pull: the bar starts on the spotter arms just below the knees, the rack in front of the lifter', () => {
    const b = get(523)
    const rack = b.implements.find((s) => s.kind === 'row_rack')!
    const bar = frameImplements(b, at(b, 0.625))[0].pos
    expect(bar[1]).toBeCloseTo(rack.sites.safety.pos[1], 2)
    const f = fk(skel, frameQ(b, 0))
    const knee = segPos(skel, f, 'tibia_l')[1]
    expect(knee - bar[1]).toBeGreaterThan(PINS.below - 0.01)
    expect(knee - bar[1]).toBeLessThan(PINS.below + 0.03)
    for (let i = 0; i < b.frames; i += 3) expect(frameImplements(b, i)[0].pos[1]).toBeGreaterThanOrEqual(rack.sites.safety.pos[1] - 0.0005)
    const rackPose = frameImplements(b, 0).find((p) => p.id === rack.id)!
    expect(rackPose.pos[2]).toBeGreaterThan(sitePos(skel, f, 'toe_l')[2])
  })

  it('B-stance: the back foot on its ball just behind the front heel, heel up, the dumbbells along the front leg', () => {
    const b = get(524)
    const f = fk(skel, frameQ(b, 0))
    const front = stance(b), back = front === 'l' ? 'r' : 'l'
    const ball = sitePos(skel, f, `ball_${back}`), heel = sitePos(skel, f, `heel_${front}`)
    expect(heel[2] - ball[2]).toBeCloseTo(SPLIT.behind, 2)
    expect(sitePos(skel, f, `heel_${back}`)[1]).toBeGreaterThan(0.05)
    expect(b.contacts.some((c) => c.site === `ball_${back}` && c.kind === 'planted')).toBe(true)
    expect(b.contacts.some((c) => c.site === `heel_${back}`)).toBe(false)
    for (let i = 0; i < b.frames; i += 3) expect(legClear(b, i, `db_${front}`)).toBeLessThan(0.06)
  })

  it('kettlebell single leg: the bell in the hand opposite the stance leg, running down near the stance shin', () => {
    const b = get(542)
    const s = stance(b)
    expect(b.contacts.find((c) => c.site === `grip_${s === 'l' ? 'r' : 'l'}`)?.target).toEqual({ implement: 'kb', grip: 'handle' })
    const f = fk(skel, frameQ(b, at(b, 0.625)))
    const bell = frameImplements(b, at(b, 0.625)).find((p) => p.id === 'kb')!.pos
    expect(Math.abs(bell[0] - segPos(skel, f, `tibia_${s}`)[0])).toBeLessThan(0.25)
    for (let i = 0; i < b.frames; i += 3) expect(legClear(b, i, 'kb')).toBeGreaterThan(-0.003)
  })

  it('trap bar: handles beside the body, arms plumb, the bar over the midfoot all rep', () => {
    for (const id of [516, 517]) {
      const b = get(id)
      for (let i = 0; i < b.frames; i += 4) {
        const f = fk(skel, frameQ(b, i))
        const bar = frameImplements(b, i).find((p) => p.id === 'trap')!.pos
        const mid = (sitePos(skel, f, 'midfoot_l')[2] + sitePos(skel, f, 'midfoot_r')[2]) / 2
        expect(Math.abs(bar[2] - mid)).toBeLessThan(0.025)
        for (const s of ['l', 'r'] as const) {
          const grip = sitePos(skel, f, `grip_${s}`)
          expect(Math.abs(Math.abs(grip[0]) - TRAP_BAR.handleX)).toBeLessThan(0.006)
          // plumb arms: the grip straight below the shoulder joint fore and aft
          expect(Math.abs(grip[2] - segPos(skel, f, `humerus_${s}`)[2])).toBeLessThan(0.03)
        }
      }
    }
  })

  it('trap-bar deadlift: plates on the floor at the bottom, knees and hips bent together (squat-like start)', () => {
    const b = get(516)
    const bar = frameImplements(b, at(b, 0.625)).find((p) => p.id === 'trap')!.pos
    expect(bar[1]).toBeCloseTo(PLATE[20].r, 2)
    expect(dof(b, 0.625, 'knee_l.flex')).toBeCloseTo(TRAP.knee, 0)
    // the handles sit low (high handles, 20 kg plates): with plumb arms the hips fold ~114 deg, a little less than the
    // conventional pull's ~120 on this figure
    expect(dof(b, 0.625, 'hip_l.flex')).toBeGreaterThan(95)
    expect(dof(b, 0.625, 'hip_l.flex')).toBeLessThan(dof(get(508), 0.625, 'hip_l.flex'))
    expect(dof(b, 0, 'knee_l.flex')).toBeLessThan(TOP_KNEE + 0.5)
  })

  it('trap-bar RDL: knees held near kneeAngle while the hips flex to BOTTOM_HIP', () => {
    const b = get(517)
    expect(dof(b, 0.625, 'hip_l.flex')).toBeCloseTo(BOTTOM_HIP.trap, 0)
    expect(dof(b, 0.625, 'knee_l.flex')).toBeCloseTo(Number(b.params.kneeAngle), 0)
  })

  it('throws for variants it does not draw yet', () => {
    const t = getTemplate('hinge')
    for (const raw of [{ implement: 'trap_bar', hold: 'hands' }, { implement: 'trap_bar', hold: 'sides', stance: 'single_leg' }]) {
      expect(() => t.sample(0, parseParams('hinge', raw), skel)).toThrow(/variant not implemented yet/)
    }
    for (const raw of [{ implement: 'dumbbell', start: 'floor', hold: 'front_of_thighs' }, { implement: 'barbell', stance: 'single_leg' }, { implement: 'cable', attachment: 'single_handle' }, { implement: 'kettlebell', stance: 'split' }, { implement: 'dumbbell', start: 'pins', hold: 'front_of_thighs' }]) {
      expect(() => t.sample(0, parseParams('hinge', raw), skel)).toThrow(/variant not implemented yet/)
    }
  })
})

import { readdirSync, readFileSync } from 'node:fs'
import { Box3, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { decode } from '../../../motion/bake.ts'
import { siteWorld } from '../../../motion/implements.ts'
import type { ImplementPose } from '../../../motion/skeleton.ts'
import { testSkeleton } from '../../../motion/testing.ts'
import { buildCableStack } from '../props/cable'
import { piecesBox } from '../props/kit'
import { buildLegPress } from '../props/legpress'
import { benchSockets } from '../props/sockets'
import { buildSmith } from '../props/smith'
import { frameFitMargin } from '../views'
import { composeMotion, type MotionExercise, type MotionScene, type Poses } from './compose'
import { hasMotion, motionIds, type MotionFile } from './library'

const skel = testSkeleton()
const BAKED = new URL('./baked/', import.meta.url)
const files = readdirSync(BAKED).filter((f) => f.endsWith('.json')).sort()

const scenes = new Map<number, { scene: MotionScene; ex: MotionExercise }>()
function scene(id: number) {
  let s = scenes.get(id)
  if (!s) {
    const file = files.find((f) => f.startsWith(`${id}-`))!
    const m = JSON.parse(readFileSync(new URL(file, BAKED), 'utf8')) as MotionFile
    const ex = JSON.parse(readFileSync(new URL(`../../../../data/exercises/${file}`, import.meta.url), 'utf8')) as MotionExercise
    s = { scene: composeMotion(ex, m.motion, skel), ex }
    scenes.set(id, s)
  }
  return s.scene
}

const posesAt = (s: MotionScene, u: number): Poses => new Map(s.poseAt(u).implements.map((p) => [p.id, p]))
const keys = (s: MotionScene) => s.props.map((p) => `${p.type}:${p.key}`).sort()
const V = (v: readonly number[]) => new Vector3(v[0], v[1], v[2])

describe('motion manifest', () => {
  it('lists every baked loop', () => {
    expect(motionIds).toEqual(files.map((f) => Number(f.split('-')[0])))
    expect(hasMotion(711)).toBe(true)
    expect(hasMotion(999)).toBe(false)
    expect(hasMotion('c1')).toBe(false)
  })
})

describe('scene composer', () => {
  it('composes every baked exercise', () => {
    for (const id of motionIds) {
      const s = scene(id)
      expect(s.frame.length, `${id}`).toBeGreaterThan(300)
      expect(s.highlight.primary?.length, `${id}`).toBeGreaterThan(0)
    }
  })

  it('picks the hero camera per template', () => {
    for (const id of motionIds) {
      const s = scene(id)
      const az = s.hero.az
      // cable curls turn further round so the stack upright in front of the lifter stays off the hands
      const cable = s.template === 'curl' && s.baked.params.implement === 'cable'
      if (s.template === 'curl') expect(az, `${id}`).toBeGreaterThanOrEqual(cable ? -65 : -45)
      if (s.template === 'curl') expect(az, `${id}`).toBeLessThanOrEqual(cable ? -55 : -25)
      if (s.template === 'lateral-raise') expect(Math.abs(az), `${id}`).toBeLessThan(20)
      if (s.template === 'vertical-pull') expect(Math.abs(az), `${id}`).toBeGreaterThan(110)
      // squats from behind (glutes and quads), except the front squat: front three-quarter so the rack reads
      if (s.template === 'squat' && s.baked.params.hold !== 'front_rack') expect(az, `${id}`).toBeLessThanOrEqual(-50)
      if (s.template === 'squat' && s.baked.params.hold === 'front_rack') expect(az, `${id}`).toBeGreaterThanOrEqual(-50)
      if (s.template === 'squat' && s.baked.params.hold === 'front_rack') expect(az, `${id}`).toBeLessThanOrEqual(-25)
    }
  })

  it('lays out the props each exercise needs', () => {
    expect(keys(scene(401))).toEqual(['rigid:bar'])
    expect(keys(scene(407))).toEqual(['dynamic:smith'])
    expect(keys(scene(402))).toEqual(['dynamic:leg-press'])
    expect(keys(scene(405))).toEqual(['dumbbell:db'])
    expect(keys(scene(408))).toEqual([])
    expect(keys(scene(301))).toEqual(['rigid:pullup'])
    expect(keys(scene(302))).toEqual(['dynamic:assisted-pullup'])
    expect(keys(scene(303))).toEqual(['dynamic:lat-pulldown'])
    expect(keys(scene(204))).toEqual(['dynamic:cable-stack'])
    expect(keys(scene(719))).toEqual(['dynamic:cable-stack'])
    expect(keys(scene(214))).toEqual(['dumbbell:db_r', 'rigid:post'])
    expect(keys(scene(702))).toEqual(['bench:bench', 'dumbbell:db_l', 'dumbbell:db_r'])
    expect(keys(scene(712))).toEqual(['dumbbell:db_l', 'dumbbell:db_r', 'rigid:bench'])
    expect(keys(scene(701))).toEqual(['rigid:bar'])
  })

  it('rebuilds machines with a stable piece layout through the rep', () => {
    for (const id of [407, 402, 302, 303, 311, 204, 713, 719]) {
      const s = scene(id)
      for (const p of s.props) {
        if (p.type !== 'dynamic') continue
        const layout = (u: number) => p.build(posesAt(s, u)).map((pc) => `${pc.geo}|${pc.mat}`).join(',')
        const first = layout(0)
        for (const u of [0.2, 0.45, 0.7]) expect(layout(u), `${id} ${p.key} @${u}`).toBe(first)
      }
    }
  })

  it('closes a wrap grip on every held implement and relaxes free hands', () => {
    for (const id of motionIds) {
      const s = scene(id)
      for (const g of s.grips) {
        const held = s.baked.contacts.some((c) => (c.site === `grip_${g.side.toLowerCase()}` || c.site === `fingers_${g.side.toLowerCase()}`) && 'implement' in c.target)
        expect(g.solution.grip === 'relaxed', `${id} ${g.side}`).toBe(!held)
      }
    }
    const rope = scene(719).grips[0].solution
    expect(rope.grip).toBe('rope')
    expect(scene(204).grips.find((g) => g.side === 'R')!.solution.grip).toBe('d-handle')
    expect(scene(301).grips[0].solution.diameter).toBeCloseTo(0.032, 6)
    expect(scene(401).grips[0].solution.diameter).toBeCloseTo(0.028, 6)
  })

  it('keeps the Smith carriages on the bar the motion moves', () => {
    const s = scene(407)
    const bar = s.baked.implements.find((i) => i.id === 'bar')!
    for (const u of [0, 0.5]) {
      const pose = posesAt(s, u).get('bar')!
      const smith = buildSmith({ barHeight: pose.pos[1], gripWidth: Math.abs(bar.sites.l.pos[0] - bar.sites.r.pos[0]) })
      expect(smith.sockets.grips.l.position.distanceTo(V(siteWorld(bar, pose, 'l').pos)), `@${u}`).toBeLessThan(0.002)
    }
  })

  it('moves the leg press sled with the template sled', () => {
    const s = scene(402)
    const a = (45 * Math.PI) / 180
    for (const u of [0, 0.5]) {
      const sled = posesAt(s, u).get('sled')!
      const d = new Vector3(0, Math.sin(a), Math.cos(a))
      const plate = buildLegPress({ sled: V(sled.pos).sub(new Vector3(0, 0.62, 0)).dot(d) }).sockets.sled.position
      expect(plate.distanceTo(V(sled.pos)), `@${u}`).toBeLessThan(0.002)
    }
  })

  it('hangs the cable from the template pulley', () => {
    for (const id of [204, 713]) {
      const s = scene(id)
      const cable = s.baked.cables![0]
      const stack = s.props.find((p) => p.key === 'cable-stack')!
      if (stack.type !== 'dynamic') throw new Error('stack is not dynamic')
      // the drawn stack's base sits around the template's column
      const box = piecesBox(stack.build(posesAt(s, 0)))
      expect(box.containsPoint(V(cable.pulley)), `${id}`).toBe(true)
      expect(buildCableStack({ pulley: cable.pulley[1] }).sockets.pulleyAt(cable.pulley[1]).y).toBeCloseTo(cable.pulley[1], 6)
    }
  })

  it('puts the incline bench surfaces where the template seats the lifter', () => {
    const s = scene(702)
    const bench = s.props.find((p) => p.type === 'bench')!
    if (bench.type !== 'bench') throw new Error('no bench')
    const spec = s.baked.implements.find((i) => i.id === 'bench')!
    const pose: ImplementPose = posesAt(s, 0).get('bench')!
    const sk = benchSockets(bench.params)
    expect(sk.seat.position.y).toBeCloseTo(pose.pos[1], 4)
    // back pad surface plane of the prop contains the template's back site
    const back = V(siteWorld(spec, pose, 'back').pos)
    const onProp = sk.back.position.clone().add(V(bench.position))
    expect(Math.abs(back.clone().sub(onProp).dot(sk.back.normal))).toBeLessThan(0.004)
  })

  it('frames the whole body over the loop and covers the floor it stands on', () => {
    for (const id of [401, 402, 711]) {
      const s = scene(id)
      const box = new Box3()
      for (let i = 0; i < s.frame.length; i += 3) box.expandByPoint(new Vector3(s.frame[i], s.frame[i + 1], s.frame[i + 2]))
      const b = decode(JSON.parse(readFileSync(new URL(files.find((f) => f.startsWith(`${id}-`))!, BAKED), 'utf8')).motion, skel)
      expect(box.max.y, `${id}`).toBeGreaterThan(b.template === 'squat' && id === 402 ? 1 : 1.7)
      expect(s.floor, `${id}`).toBeGreaterThan(Math.max(Math.abs(box.min.z), Math.abs(box.max.z)) - 0.5)
    }
  })

  it('frames equipment bases and loaded plates: the pull-up station, the lean-away post, the leg press plates', () => {
    const box = (s: MotionScene) => {
      const b = new Box3()
      for (let i = 0; i < s.frame.length; i += 3) b.expandByPoint(new Vector3(s.frame[i], s.frame[i + 1], s.frame[i + 2]))
      return b
    }
    for (const id of [301, 309, 310]) {
      const b = box(scene(id))
      expect(b.min.y, `${id}`).toBeLessThanOrEqual(0.001)
      expect(Math.min(-b.min.z, b.max.z), `${id}`).toBeGreaterThan(0.55)
      expect(Math.min(-b.min.x, b.max.x), `${id}`).toBeGreaterThan(0.7)
    }
    const post = scene(214).baked.implements.find((i) => i.id === 'post')!.parts[0]
    if (post.shape !== 'cylinder') throw new Error('post is not a cylinder')
    expect(box(scene(214)).containsPoint(new Vector3(post.a[0] + Math.sign(post.a[0]) * 0.14, 0, post.a[2] + 0.14))).toBe(true)
    const press = box(scene(402))
    expect(Math.min(-press.min.x, press.max.x)).toBeGreaterThan(0.7)
    expect(press.min.y).toBeLessThanOrEqual(0.001)
  })

  it('keeps the framed points 6 % clear of every edge from the hero camera', () => {
    for (const id of [203, 310, 401, 402, 405, 702]) {
      const s = scene(id)
      const cam = new PerspectiveCamera(24, 390 / 480)
      frameFitMargin(cam, s.frame, (s.hero.az * Math.PI) / 180, 0.065, s.hero.elev)
      cam.updateMatrixWorld()
      let edge = 0
      const p = new Vector3()
      for (let i = 0; i < s.frame.length; i += 3) {
        p.set(s.frame[i], s.frame[i + 1], s.frame[i + 2]).project(cam)
        edge = Math.max(edge, Math.abs(p.x), Math.abs(p.y))
      }
      expect(edge, `${id}`).toBeLessThanOrEqual(1 - 2 * 0.06)
      expect(edge, `${id}`).toBeGreaterThan(0.8)
    }
  })

  it('highlights the working side of unilateral exercises and pulses on the concentric only', () => {
    expect(scene(204).highlight.side).toBe('r')
    expect(scene(711).highlight.side).toBeUndefined()
    const s = scene(711)
    expect(s.pulseAt(s.midRep)).toBeCloseTo(0.5, 2)
    expect(s.pulseAt(0)).toBeNull()
  })
})

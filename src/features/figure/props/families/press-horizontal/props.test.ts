import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { bake, frameImplements, type Baked } from '../../../../../motion/bake.ts'
import { siteWorld } from '../../../../../motion/implements.ts'
import { BENCH_RACK, PRESS_BENCH } from '../../../../../motion/implements/press-horizontal.ts'
import { testSkeleton } from '../../../../../motion/testing.ts'
import { getTemplate, parseParams } from '../../../../../motion/templates/index.ts'
import { BENCH } from '../../sockets.ts'
import { chestPressParams, layouts } from '../press-horizontal.ts'
import { buildChestPress } from './chest-press.ts'
import { buildUprights } from './uprights.ts'

const skel = testSkeleton()
const run = (raw: Record<string, unknown>): Baked => bake(getTemplate('horizontal-press'), parseParams('horizontal-press', raw, 'bilateral'), skel)
const machine = run({ implement: 'machine', machine: 'chest_press_machine', posture: 'seated', grip: 'neutral', gripWidth: 1.4 })
const barbell = run({ implement: 'barbell', gripWidth: 1.4, elbowFlare: 45 })
const poses = (b: Baked, i: number) => new Map(frameImplements(b, i).map((p) => [p.id, p]))

describe('F1 press props', () => {
  it('the press bench has the drawn adjustable bench pads and stabilisers', () => {
    expect(PRESS_BENCH.seat).toEqual(BENCH.seat)
    expect(PRESS_BENCH.back).toEqual(BENCH.back)
    expect([PRESS_BENCH.frontZ, PRESS_BENCH.rearZ]).toEqual([BENCH.frontZ, BENCH.rearZ])
  })

  it('the drawn chest press handles sit on the lever implement grips all through the loop', () => {
    const arms = machine.implements.find((s) => s.kind === 'press_arms')!
    const frame = machine.implements.find((s) => s.kind === 'chest_press')!
    const params = chestPressParams(machine, frame, arms)
    const lifts: number[] = []
    for (let i = 0; i < machine.frames; i += 7) {
      const ps = poses(machine, i)
      const p = params(ps)
      lifts.push(p.stackLift ?? 0)
      const { grips } = buildChestPress(p).sockets
      for (const s of ['l', 'r'] as const) {
        const want = siteWorld(arms, ps.get(arms.id)!, s)
        expect(grips[s].position.distanceTo(new Vector3(...want.pos))).toBeLessThan(1e-6)
        expect(Math.abs(grips[s].axis.dot(new Vector3(...want.axis!)))).toBeGreaterThan(0.9999)
      }
    }
    // the stack rests with the hands back and rides up as the levers push forward
    expect(Math.min(...lifts)).toBeLessThan(1e-6)
    expect(Math.max(...lifts)).toBeGreaterThan(0.03)
  })

  it('the J-cups sit just below the locked-out bar, towards the head, the posts well outside the hands', () => {
    const rack = barbell.implements.find((s) => s.kind === 'bench_rack')!
    const ps = poses(barbell, 0)
    const rest = buildUprights({ hookHeight: rack.sites.l.pos[1] }).sockets.barRest.position.clone().add(new Vector3(...ps.get(rack.id)!.pos))
    const bar = ps.get('bar')!.pos
    expect(bar[1] - rest.y).toBeGreaterThan(0.03)
    expect(bar[1] - rest.y).toBeLessThan(0.08)
    expect(bar[2] - rest.z).toBeGreaterThan(0.05)
    expect(bar[2] - rest.z).toBeLessThan(0.15)
    const hand = barbell.implements.find((s) => s.id === 'bar')!.sites.l.pos[0]
    expect(BENCH_RACK.x - BENCH_RACK.post / 2 - hand).toBeGreaterThan(0.12)
  })

  it('lays out the uprights for barbell benching and the chest press for the machine, both framed whole', () => {
    expect(layouts(barbell).map((l) => [l.key, l.whole])).toEqual([['rack', true]])
    expect(layouts(machine).map((l) => [l.key, l.whole])).toEqual([['chest-press', true]])
    expect(layouts(run({ implement: 'dumbbell' }))).toEqual([])
  })
})

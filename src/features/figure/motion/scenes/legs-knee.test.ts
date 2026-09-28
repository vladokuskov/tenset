import { readdirSync, readFileSync } from 'node:fs'
import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { testSkeleton } from '../../../../motion/testing.ts'
import { frameFitMargin } from '../../views'
import { composeMotion, type MotionExercise } from '../compose'
import type { MotionFile } from '../library'

// F5 legs-knee scenes: hero framing, highlight and the equipment each loop draws, from the baked loops.

const skel = testSkeleton()
const BAKED = new URL('../baked/', import.meta.url)
const files = readdirSync(BAKED).filter((f) => f.endsWith('.json'))
const IDS = [403, 404, 409, 410, 411, 412, 503, 504, 512]

function scene(id: number) {
  const file = files.find((f) => f.startsWith(`${id}-`))!
  const m = JSON.parse(readFileSync(new URL(file, BAKED), 'utf8')) as MotionFile
  const ex = JSON.parse(readFileSync(new URL(`../../../../../data/exercises/${file}`, import.meta.url), 'utf8')) as MotionExercise
  return composeMotion(ex, m.motion, skel)
}

describe('legs-knee scenes', () => {
  it.each(IDS)('%s: framed points stay 6 %% clear of every edge from the hero camera', (id) => {
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
    expect(edge).toBeLessThanOrEqual(1 - 2 * 0.06)
    expect(edge).toBeGreaterThan(0.8)
  })

  it('draws the equipment where the templates put it: bench, box, knee machines, Nordic station', () => {
    const keys = (id: number) => scene(id).props.map((p) => p.key)
    expect(keys(403)).toContain('split-bench')
    expect(keys(410)).toContain('box')
    for (const id of [404, 412, 503, 504]) expect(keys(id)).toContain('knee-machine')
    expect(keys(512)).toEqual(expect.arrayContaining(['nordic-station', 'catch-mat']))
  })

  it('highlights the leading right leg on the lunges, both legs on the machines', () => {
    for (const id of [403, 409, 410, 411]) expect(scene(id).highlight.side, `${id}`).toBe('r')
    for (const id of [404, 412, 503, 504, 512]) expect(scene(id).highlight.side, `${id}`).toBeUndefined()
  })
})

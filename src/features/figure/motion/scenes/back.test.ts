import { readdirSync, readFileSync } from 'node:fs'
import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { frameImplements, frameQ } from '../../../../motion/bake.ts'
import { fk, segPos, sitePos } from '../../../../motion/fk.ts'
import { testSkeleton } from '../../../../motion/testing.ts'
import { RACK } from '../../props/rack.ts'
import { frameFitMargin } from '../../views'
import { composeMotion, type MotionExercise } from '../compose'
import type { MotionFile } from '../library'

// F4 back scenes: hero framing, working-side highlight and grips in view, from the baked loops.

const skel = testSkeleton()
const BAKED = new URL('../baked/', import.meta.url)
const files = readdirSync(BAKED).filter((f) => f.endsWith('.json'))
const IDS = [206, 304, 305, 306, 307, 308, 312, 313, 314, 315]

function scene(id: number) {
  const file = files.find((f) => f.startsWith(`${id}-`))!
  const m = JSON.parse(readFileSync(new URL(file, BAKED), 'utf8')) as MotionFile
  const ex = JSON.parse(readFileSync(new URL(`../../../../../data/exercises/${file}`, import.meta.url), 'utf8')) as MotionExercise
  return composeMotion(ex, m.motion, skel)
}

function heroCam(s: ReturnType<typeof scene>) {
  const cam = new PerspectiveCamera(24, 390 / 480)
  frameFitMargin(cam, s.frame, (s.hero.az * Math.PI) / 180, 0.065, s.hero.elev)
  cam.updateMatrixWorld()
  return cam
}

describe('back scenes', () => {
  it.each(IDS)('%s: framed points stay 6 %% clear of every edge from the hero camera', (id) => {
    const s = scene(id)
    const cam = heroCam(s)
    let edge = 0
    const p = new Vector3()
    for (let i = 0; i < s.frame.length; i += 3) {
      p.set(s.frame[i], s.frame[i + 1], s.frame[i + 2]).project(cam)
      edge = Math.max(edge, Math.abs(p.x), Math.abs(p.y))
    }
    expect(edge).toBeLessThanOrEqual(1 - 2 * 0.06)
    expect(edge).toBeGreaterThan(0.8)
  })

  it('highlights the working (right) side only on the one-arm rows, both sides elsewhere', () => {
    for (const id of [307, 315]) expect(scene(id).highlight.side, `${id}`).toBe('r')
    for (const id of [206, 304, 305, 306, 308, 312, 313, 314]) expect(scene(id).highlight.side, `${id}`).toBeUndefined()
  })

  it('inverted row: no rack upright stands between the hero camera and either hand or the head', () => {
    const s = scene(313)
    const cam = heroCam(s)
    const c = cam.position
    const b = s.baked
    const rack = b.implements.findIndex((x) => x.kind === 'row_rack')
    // clearance from the upright's axis to the line of sight: half the post plus a fist
    const clear = RACK.post / 2 + 0.045
    for (let i = 0; i < b.frames; i += 5) {
      const f = fk(skel, frameQ(b, i))
      const origin = frameImplements(b, i)[rack].pos
      // the -50 deg camera had the near front upright across the head for half the loop
      for (const [what, h] of [['hand l', sitePos(skel, f, 'grip_l')], ['hand r', sitePos(skel, f, 'grip_r')], ['head', segPos(skel, f, 'head')]] as const) {
        for (const ux of [-RACK.x, RACK.x]) {
          for (const uz of [0, -RACK.depth]) {
            const px = origin[0] + ux, pz = origin[2] + uz
            // closest approach of the camera-to-hand segment to the vertical upright axis, in plan
            const dx = h[0] - c.x, dz = h[2] - c.z
            const t = Math.max(0, Math.min(1, ((px - c.x) * dx + (pz - c.z) * dz) / (dx * dx + dz * dz)))
            if (t <= 0 || t >= 0.98) continue
            const y = c.y + (h[1] - c.y) * t
            if (y < 0 || y > RACK.height) continue
            const d = Math.hypot(c.x + dx * t - px, c.z + dz * t - pz)
            expect(d, `frame ${i} ${what} upright ${ux},${uz}`).toBeGreaterThan(clear)
          }
        }
      }
    }
  })
})

import { describe, expect, it } from 'vitest'
import { MOVING_KINDS } from '../../../../motion/implements/index.ts'
import { TEMPLATE_IDS } from '../../../../motion/templates/index.ts'
import { duplicateGrips } from '../../grips/index.ts'
import { computeGrip, coreGripNames, gripNames, isWrapGrip, registerGrip, type GripName } from '../../hands'
import { heroCamera } from '../compose'
import { defaultCamera, pendingScene, SCENES, sceneFor } from './index.ts'

describe('scene modules', () => {
  it('exist for every template id', () => {
    expect(Object.keys(SCENES).sort()).toEqual([...TEMPLATE_IDS].sort())
  })

  it('give pending templates the default camera: front three-quarter for F, rear three-quarter for B', () => {
    expect(defaultCamera('F').az).toBeGreaterThan(-60)
    expect(defaultCamera('F').az).toBeLessThan(-20)
    expect(defaultCamera('B').az).toBeLessThan(-120)
    for (const v of ['F', 'B'] as const) expect(pendingScene().camera({}, v)).toEqual(defaultCamera(v))
    expect(sceneFor('not-a-template').camera({}, 'B')).toEqual(defaultCamera('B'))
    for (const id of TEMPLATE_IDS) {
      for (const v of ['F', 'B'] as const) {
        const c = heroCamera(id, {}, v)
        expect(Math.abs(c.az), `${id} ${v}`).toBeLessThanOrEqual(180)
        expect(c.elev, `${id} ${v}`).toBeGreaterThanOrEqual(0)
        expect(c.elev, `${id} ${v}`).toBeLessThan(0.6)
      }
    }
  })

  it('keep the approved cameras', () => {
    expect(heroCamera('curl', { implement: 'cable' }, 'F')).toEqual({ az: -60, elev: 0.3 })
    expect(heroCamera('curl', { implement: 'dumbbell' }, 'F')).toEqual({ az: -35, elev: 0.3 })
    expect(heroCamera('lateral-raise', {}, 'F')).toEqual({ az: -14, elev: 0.18 })
    expect(heroCamera('vertical-pull', { posture: 'seated' }, 'B')).toEqual({ az: -118, elev: 0.22 })
    expect(heroCamera('squat', { implement: 'barbell', hold: 'back_high' }, 'F')).toEqual({ az: -128, elev: 0.22 })
    expect(heroCamera('squat', { implement: 'barbell', hold: 'front_rack' }, 'F')).toEqual({ az: -40, elev: 0.2 })
  })
})

describe('family extension registries', () => {
  it('merge family grips into the hand library without name clashes', () => {
    expect(duplicateGrips(coreGripNames)).toEqual([])
    expect(gripNames).toEqual(expect.arrayContaining([...coreGripNames]))
  })

  it('solve family hand shapes like the core ones they are built like', () => {
    registerGrip('test-relaxed', {
      diameter: 0.033,
      posed: { mcp: [14, 18, 22, 26], pip: [18, 24, 28, 32], dip: [6, 8, 10, 10], spread: 0.45, thumb: { bone: 'finger2-2', at: 0.2, radial: 0.013, palmar: 0.008 } },
    })
    registerGrip('test-pronated', { diameter: 0.033, wrap: { tilt: 8, depth: 0.012, spread: 0.55, thumb: 'wrap' } })
    for (const [mine, core] of [['test-relaxed', 'relaxed'], ['test-pronated', 'pronated']] as const) {
      const a = computeGrip(mine as GripName), b = computeGrip(core)
      expect(isWrapGrip(mine as GripName)).toBe(isWrapGrip(core))
      for (const n of Object.keys(b.deltas)) expect(a.deltas[n].angleTo(b.deltas[n]), `${mine} ${n}`).toBeLessThan(1e-6)
    }
  })

  it('collect moving implement kinds for the equipment check', () => {
    for (const k of ['barbell', 'ez_bar', 'dumbbell', 'cable_handle']) expect(MOVING_KINDS.has(k)).toBe(true)
    for (const k of ['bench', 'plyo_box', 'mat', 'wall']) expect(MOVING_KINDS.has(k)).toBe(false)
  })
})

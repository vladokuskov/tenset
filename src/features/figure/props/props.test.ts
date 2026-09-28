import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { barbell, cableHandle, ezBar, NEUTRAL_HANDLE, pullupBar, type Attachment, type ImplementSpec } from '../../../motion/implements.ts'
import { buildBarbell, buildEzBar } from './barbell'
import { ATTACHMENT_EYE, buildAttachment, buildCableStack, PULLEY_HEIGHTS } from './cable'
import { geometry, type PropBuild } from './kit'
import { buildLegPress } from './legpress'
import { WHEEL_R } from './parts'
import { buildLatPulldown } from './pulldown'
import { buildAssistedPullup, buildPullupStation } from './pullup'
import { buildSquatRack, RACK } from './rack'
import { buildSmith, SMITH } from './smith'
import type { GripSocket } from './sockets'

const v = (a: readonly number[]) => new Vector3(a[0], a[1], a[2])

function expectSites(grips: Record<string, GripSocket>, spec: ImplementSpec, offset = new Vector3(), axes = true) {
  for (const [k, s] of Object.entries(spec.sites)) {
    expect(grips[k], k).toBeDefined()
    expect(grips[k].position.distanceTo(v(s.pos).add(offset)), k).toBeLessThan(1e-9)
    if (axes && s.axis) expect(grips[k].axis.distanceTo(v(s.axis).normalize()), k).toBeLessThan(1e-9)
  }
}

function expectSane(b: PropBuild<unknown>, maxPieces = 800) {
  expect(b.bbox.isEmpty()).toBe(false)
  for (const p of b.pieces) {
    expect(p.matrix.elements.every(Number.isFinite), p.geo).toBe(true)
    expect(geometry(p.geo).getAttribute('position').array.every(Number.isFinite), p.geo).toBe(true)
  }
  expect(b.pieces.length).toBeLessThan(maxPieces)
  // instancing: few distinct geometry/material pairs per prop
  expect(new Set(b.pieces.map((p) => `${p.geo}|${p.mat}`)).size).toBeLessThan(90)
}

describe('bars match the motion implements', () => {
  it('barbell: grips, length, shaft and plates as barbell()', () => {
    for (const [gripWidth, plates] of [[0.8, 2], [1.2, 0], [0.5, 3]]) {
      const b = buildBarbell({ gripWidth, plates })
      const spec = barbell({ gripWidth, plateKg: 20 * plates })
      expectSites(b.sockets.grips, spec)
      expect(b.bbox.max.x).toBeCloseTo(1.1, 6)
      expect(b.bbox.min.x).toBeCloseTo(-1.1, 6)
      expect(b.sockets.collarX).toBeCloseTo(0.64, 6)
      expect(b.sockets.floorHeight).toBeCloseTo(plates ? 0.225 : 0.04, 6)
      expect(b.pieces.filter((p) => p.geo.startsWith('plate:')).length).toBe(2 * plates)
      const knurl = b.pieces.filter((p) => p.geo.startsWith('knurl:'))
      expect(knurl.length).toBe(2)
      for (const k of knurl) expect(Number(k.geo.split(':')[1])).toBe(0.014)
      expectSane(b)
    }
  })

  it('EZ bar: sites and envelope as ezBar()', () => {
    const b = buildEzBar({ plateKg: 10 })
    expectSites(b.sockets.grips, ezBar({ plateKg: 10 }))
    expect(b.bbox.max.x).toBeCloseTo(0.6, 6)
    expectSane(b)
  })

  it('cable attachments keep the descriptor grips (EZ: positions, cambered axes)', () => {
    const kinds: Attachment[] = ['rope', 'straight_bar', 'ez_bar', 'v_bar', 'single_handle', 'long_bar', 'ankle_strap']
    for (const kind of kinds) {
      const b = buildAttachment(kind)
      const spec = cableHandle({ attachment: kind })
      expectSites(b.sockets.grips, spec, new Vector3(), kind !== 'ez_bar')
      expect(b.sockets.eye.equals(ATTACHMENT_EYE)).toBe(true)
      expectSane(b)
    }
    const ez = buildAttachment('ez_bar').sockets.grips
    expect(ez.l.axis.x).toBeGreaterThan(0.9)
    expect(Math.sign(ez.l.axis.z)).toBe(-Math.sign(ez.r.axis.z))
  })

  it('draws a template-built descriptor when given one (the curl widened rope)', () => {
    const base = cableHandle({ attachment: 'rope' })
    const wide: ImplementSpec = { ...base, parts: base.parts.map((p) => (p.shape === 'cylinder' ? { ...p, b: [p.b[0] * 1.3, -0.3, 0] } : p)), sites: { l: { pos: [0.14, -0.26, 0], axis: [0.47, -0.88, 0] }, r: { pos: [-0.14, -0.26, 0], axis: [-0.47, -0.88, 0] } } }
    expectSites(buildAttachment('rope', wide).sockets.grips, wide)
  })
})

describe('racks and stations', () => {
  it('a racked Olympic bar sits on the J-hooks inside its collars and outside the hands', () => {
    const rack = buildSquatRack({ hookHeight: 1.36 })
    const bar = buildBarbell({ gripWidth: 0.95 })
    expect(rack.sockets.barRest.position.y).toBe(1.36)
    expect(bar.sockets.collarX - (RACK.x + RACK.post / 2)).toBeGreaterThan(0.03)
    expect(RACK.x - RACK.post / 2).toBeGreaterThan(0.95 / 2 + 0.04)
    // the bar clears the hooks' front lip and the uprights
    expect(rack.sockets.barRest.position.z - 0.014).toBeGreaterThan(RACK.post / 2 + 0.01)
    expectSane(rack)
  })

  it('smith: bar on the template rail line, carriages inside the collars', () => {
    const s = buildSmith({ barHeight: 1.3, gripWidth: 0.95 })
    expectSites(s.sockets.grips, barbell({ gripWidth: 0.95, plateKg: 20 }), new Vector3(0, 1.3, 0))
    expect(s.sockets.barPath.z).toBe(0)
    expect(SMITH.railX + 0.0375).toBeLessThan(s.sockets.bar.collarX)
    expect(s.sockets.barPath.min).toBeLessThan(1.1)
    expectSane(s)
  })

  it('pull-up station and assisted machine: bar and grips as pullupBar()', () => {
    const st = buildPullupStation({ height: 2.4, gripWidth: 0.68 })
    expectSites(st.sockets.grips, pullupBar({ height: 2.4, gripWidth: 0.68 }), new Vector3(0, 2.4, 0))
    expect(st.sockets.bar.half).toBeCloseTo(0.65, 9)
    expectSane(st)
    const n = buildPullupStation({ neutral: true, gripWidth: 0.5 })
    expectSites(n.sockets.grips, pullupBar({ height: 2.4, gripWidth: 0.5, neutral: true }), new Vector3(0, 2.4, 0))
    expect(n.sockets.grips.l.position.z).toBeCloseTo((NEUTRAL_HANDLE.from + NEUTRAL_HANDLE.to) / 2, 9)
    expect(n.sockets.grips.l.axis.toArray()).toEqual([0, 0, 1])
    const a = buildAssistedPullup({ pad: [0, 1.0, 0.03] })
    expectSites(a.sockets.grips, pullupBar({ height: 2.4, gripWidth: 0.68 }), new Vector3(0, 2.4, 0))
    expect(a.sockets.pad.position.toArray()).toEqual([0, 1.035, 0.03])
    expectSane(a)
  })
})

describe('cable machines', () => {
  it('stack: the cable leaves the wheel tangentially towards the attachment eye', () => {
    for (const pulley of ['low', 'mid', 'high'] as const) {
      const b = buildCableStack({ pulley, attachment: 'rope', handle: { pos: [0.1, 1.1, 0.55] } })
      const { cable, eye } = b.sockets
      expect(cable.pulley.y).toBe(PULLEY_HEIGHTS[pulley])
      expect(cable.exit.distanceTo(cable.pulley)).toBeCloseTo(WHEEL_R, 9)
      expect(cable.exit.clone().sub(cable.pulley).dot(cable.direction)).toBeCloseTo(0, 6)
      expect(eye.clone().sub(cable.exit).normalize().distanceTo(cable.direction)).toBeLessThan(1e-9)
      expectSane(b)
    }
  })

  it('stack: an unrotated attachment hangs along its cable', () => {
    const b = buildCableStack({ pulley: 'low', attachment: 'straight_bar', handle: { pos: [0, 1.2, 0.4] } })
    const g = b.sockets.grips
    const mid = g.l.position.clone().add(g.r.position).multiplyScalar(0.5)
    const along = b.sockets.eye.clone().sub(mid).normalize()
    expect(along.dot(b.sockets.cable.direction)).toBeLessThan(-0.999)
  })

  it('lat pulldown: the cable leaves at the template pulley point for its default handle', () => {
    const b = buildLatPulldown()
    expect(b.sockets.cable.exit.distanceTo(new Vector3(0, 2.4, 0.142))).toBeLessThan(0.004)
    expect(b.sockets.seat.position.y).toBeCloseTo(0.43, 9)
    expect(b.sockets.thighPad.axle.toArray()).toEqual([0, 0.633, 0.355])
    expect(b.sockets.grips.l.position.distanceTo(b.sockets.grips.r.position)).toBeCloseTo(0.96, 9)
    expectSane(b)
  })

  it('leg press: sled pose and pads as the template places them at 45 degrees', () => {
    const b = buildLegPress({ sled: 0.8 })
    const s = b.sockets
    const d = new Vector3(0, Math.SQRT1_2, Math.SQRT1_2)
    expect(s.sled.position.distanceTo(new Vector3(0, 0.62, 0).addScaledVector(d, 0.8))).toBeLessThan(1e-9)
    expect(new Vector3(0, 1, 0).applyQuaternion(s.sled.quaternion).distanceTo(d.clone().negate())).toBeLessThan(1e-9)
    // template: seat box centre (0, 0.589, 0.14), back pad centre (0, 0.673, -0.333), both 0.06 thick
    expect(s.seat.position.clone().addScaledVector(s.seat.normal, -0.0325).distanceTo(new Vector3(0, 0.589, 0.14))).toBeLessThan(0.01)
    expect(s.back.position.clone().addScaledVector(s.back.normal, -0.0325).distanceTo(new Vector3(0, 0.673, -0.333))).toBeLessThan(0.01)
    expect(s.grips.l.position.toArray()).toEqual([0.346, 0.959, 0.221])
    expectSane(b)
  })
})

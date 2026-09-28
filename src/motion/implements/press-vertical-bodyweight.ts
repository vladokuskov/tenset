import { restAgainst, type Capsule } from '../collide.ts'
import type { ImplementSpec, Part } from '../implements.ts'
import { DEG, qaxis, type V3 } from '../math.ts'
import type { ImplementPose } from '../skeleton.ts'

// F2 press-vertical-bodyweight: the shoulder press machine (handles on a lever arc, seat and back pad), the dip
// station's parallel bars and the floor contact for push-up hands. The figure props (props/families/
// press-vertical-bodyweight.ts) draw them at exactly these dimensions.
export const KINDS = ['press_handles', 'shoulder_press', 'dip_bars', 'floor_contact'] as const
export const MOVING: readonly string[] = ['press_handles']

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

// ---------- shoulder press machine ----------

/**
 * Lever machine: both handles ride one lever pair that pivots about a horizontal axis behind the seat, so they rise
 * on an arc of radius `arm` (up and a little back). Lever arms run outside the lifter's elbows at |x| = lever.
 */
export const PRESS_MACHINE = { arm: 0.72, lever: 0.55, handleR: 0.017, inner: 0.07, seat: [0.4, 0.07, 0.38] as V3, back: [0.34, 0.62, 0.07] as V3 }

export type PressGeometry = {
  /** lever pivot (x = 0), world */
  pivot: V3
  /** grip half width, m */
  half: number
  arm: number
  /** lever angle above horizontal at the bottom and the top of the rep, deg */
  angle0: number
  angle1: number
  /** seat pad top height */
  seat: number
  /** back pad centre, world */
  back: V3
}

export const pressHandles = {
  /** handle bars from the lever arms in to just inside the grips; frame at the midpoint between the handles, local +Z
   * along the lever (away from the pivot) */
  spec(g: PressGeometry): ImplementSpec {
    const { lever, handleR, inner } = PRESS_MACHINE
    const x0 = Math.max(0.12, g.half - inner)
    return {
      id: 'handles',
      kind: 'press_handles',
      mass: 0,
      com: [0, 0, 0],
      parts: [cyl([x0, 0, 0], [lever, 0, 0], handleR), cyl([-x0, 0, 0], [-lever, 0, 0], handleR)],
      sites: { l: { pos: [g.half, 0, 0], axis: [1, 0, 0] }, r: { pos: [-g.half, 0, 0], axis: [1, 0, 0] } },
    }
  },
  pose(g: PressGeometry, angle: number): ImplementPose {
    const a = angle * DEG
    return { id: 'handles', pos: [g.pivot[0], g.pivot[1] + g.arm * Math.sin(a), g.pivot[2] + g.arm * Math.cos(a)], rot: qaxis([1, 0, 0], -a) }
  },
}

export const pressMachineFrame = {
  /** seat and back pads (padded), world frame */
  spec(g: PressGeometry): ImplementSpec {
    const { seat, back } = PRESS_MACHINE
    return {
      id: 'shoulder-press',
      kind: 'shoulder_press',
      mass: 0,
      com: [0, 0, 0],
      parts: [
        { shape: 'box', center: [0, g.seat - seat[1] / 2, 0.04], size: seat, pad: true },
        { shape: 'box', center: g.back, size: back, pad: true },
      ],
      sites: {},
    }
  },
  /** seat top under the glutes and back pad centre against the back, from the seated body's capsules */
  fit(caps: Capsule[], g: PressGeometry): V3 {
    const trunk = caps.filter((c) => c.region === 'trunk')
    const seat = restAgainst(caps.filter((c) => c.region === 'trunk' || /^thigh_[lr]1/.test(c.name)), { shape: 'box', center: [0, 0.4, 0.04], size: PRESS_MACHINE.seat, pad: true }, [0, -1, 0])
    g.seat = seat.center[1] + PRESS_MACHINE.seat[1] / 2
    const pad = restAgainst(trunk, { shape: 'box', center: [0, g.seat + 0.08 + PRESS_MACHINE.back[1] / 2, -0.15], size: PRESS_MACHINE.back, pad: true }, [0, 0, -1])
    return pad.center
  },
}

// ---------- dip station ----------

/** parallel bars: grip height, centre-to-centre spacing (wide enough for the hips to pass), bar radius and length */
export const DIP = { height: 1.25, width: 0.64, r: 0.022, from: -0.3, to: 0.3 }

/** Dip bars: local origin on the floor between the grips, bars along Z (the lifter faces +Z). Sites at the grips,
 * axis along the bar (little finger to index for a neutral grip, thumbs forward). */
export function dipBars(o: { id?: string } = {}): ImplementSpec {
  const g = DIP.width / 2
  return {
    id: o.id ?? 'dip',
    kind: 'dip_bars',
    mass: 0,
    com: [0, 0, 0],
    parts: [cyl([g, DIP.height, DIP.from], [g, DIP.height, DIP.to], DIP.r), cyl([-g, DIP.height, DIP.from], [-g, DIP.height, DIP.to], DIP.r)],
    sites: { l: { pos: [g, DIP.height, 0], axis: [0, 0, 1] }, r: { pos: [-g, DIP.height, 0], axis: [0, 0, 1] } },
  }
}

// ---------- push-up palms ----------

/** Where flat palms rest (the floor or a box top): no parts, just the two hand sites, so the hands count as held and
 * take the flat-palm shape. Local origin between the hands on the support surface; sites at the grip sites of palms
 * lying flat (the grip site sits at the palm's surface, by the finger roots), axis little finger to index. */
export function palmRest(o: { id?: string; half: number }): ImplementSpec {
  return {
    id: o.id ?? 'palms',
    kind: 'floor_contact',
    mass: 0,
    com: [0, 0, 0],
    parts: [],
    sites: { l: { pos: [o.half, 0, 0], axis: [-1, 0, 0], normal: [0, 1, 0] }, r: { pos: [-o.half, 0, 0], axis: [1, 0, 0], normal: [0, 1, 0] } },
  }
}

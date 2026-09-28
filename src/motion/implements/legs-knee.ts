import type { ImplementSpec, Part } from '../implements.ts'
import type { Quat, V3 } from '../math.ts'

// F5 legs-knee: knee machines (leg extension with a reclinable back, seated and lying leg curl), the Nordic station and
// the catch pad. Templates place the pads against the measured body; the drawn props (figure/props/families/legs-knee)
// read their geometry back from these specs, so what the QA gate collides with is what the composer draws.

/** `hand_pose`: a partless marker that follows a hand, so the scene can give a free hand a posed shape (flat palm) */
export const KINDS = ['leg_extension', 'leg_curl_seated', 'leg_curl_lying', 'nordic_station', 'knee_lever', 'machine_handles', 'catch_pad', 'hand_pose', 'split_bench'] as const
export const MOVING: readonly string[] = []

/** shared machine dimensions, m */
export const KNEE_MACHINE = {
  /** shin / heel roller: radius and half length across the legs */
  roller: { r: 0.052, half: 0.23 },
  /** lever arm outside the lifter's left leg (+X), tube width */
  arm: { x: 0.3, w: 0.05 },
  /** round pivot housing on the knee axis */
  pivot: { r: 0.075, x: 0.3 },
  handle: { r: 0.016, len: 0.2 },
  pad: { thick: 0.07 },
}

type Box = Extract<Part, { shape: 'box' }>

const box = (center: V3, size: V3, rot?: Quat, pad = true): Box => ({ shape: 'box', center, size, ...(rot ? { rot } : {}), pad })

/**
 * Knee machine frame (fixed, world pose identity): the pads the body rests on plus the pivot on the knee axis. Sites:
 * `pivot` (axis along X), `stack` (weight stack base centre on the floor). Parts: seat, back pad and (seated curl) the
 * thigh pad over the knees, or the lying bench's thigh and chest pads.
 */
export function kneeMachine(o: {
  id?: string
  kind: 'leg_extension' | 'leg_curl_seated' | 'leg_curl_lying'
  pads: Record<string, Box>
  pivot: V3
  stack: V3
}): ImplementSpec {
  return {
    id: o.id ?? 'machine',
    kind: o.kind,
    mass: 0,
    com: [0, 0, 0],
    parts: Object.values(o.pads),
    sites: { pivot: { pos: o.pivot, axis: [1, 0, 0] }, stack: { pos: o.stack, normal: [0, 1, 0] }, ...Object.fromEntries(Object.entries(o.pads).map(([k, b]) => [k, { pos: b.center }])) },
  }
}

export { box as padBox }

/**
 * Lever that turns with the lower leg about the knee axis. Local frame at the pivot: +Z along the shin when the knee is
 * straight, +Y the shin's front. `roller` is the pad's axle centre (local, x = 0); the arm runs outside the left leg.
 */
export function kneeLever(o: { id?: string; roller: V3 }): ImplementSpec {
  const { roller: R, arm, pivot } = KNEE_MACHINE
  const c = o.roller
  return {
    id: o.id ?? 'lever',
    kind: 'knee_lever',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      { shape: 'cylinder', a: [-R.half, c[1], c[2]], b: [R.half, c[1], c[2]], r: R.r, pad: true },
      { shape: 'box', center: [arm.x, c[1] / 2, c[2] / 2], size: [arm.w, 0.05, Math.hypot(c[1], c[2]) + 0.05], rot: tiltX(Math.atan2(c[1], c[2])) },
      { shape: 'cylinder', a: [pivot.x - 0.03, 0, 0], b: [pivot.x + 0.03, 0, 0], r: pivot.r },
    ],
    sites: { roller: { pos: c, axis: [1, 0, 0] } },
  }
}

/** rotation about +X taking +Z towards +Y by a (rad) */
function tiltX(a: number): Quat {
  return [-Math.sin(a / 2), 0, 0, Math.cos(a / 2)]
}

/** side hand holds (fixed): short horizontal bars, sites l / r along the bar */
export function machineHandles(o: { id?: string; l: { pos: V3; axis: V3 }; r: { pos: V3; axis: V3 } }): ImplementSpec {
  const { r, len } = KNEE_MACHINE.handle
  const bar = (s: { pos: V3; axis: V3 }): Part => ({
    shape: 'cylinder',
    a: [s.pos[0] - (s.axis[0] * len) / 2, s.pos[1] - (s.axis[1] * len) / 2, s.pos[2] - (s.axis[2] * len) / 2],
    b: [s.pos[0] + (s.axis[0] * len) / 2, s.pos[1] + (s.axis[1] * len) / 2, s.pos[2] + (s.axis[2] * len) / 2],
    r,
  })
  return { id: o.id ?? 'handles', kind: 'machine_handles', mass: 0, com: [0, 0, 0], parts: [bar(o.l), bar(o.r)], sites: { l: o.l, r: o.r } }
}

export const NORDIC = {
  /** kneeling pad on a low padded base */
  knee: { width: 0.5, depth: 0.42, thick: 0.06, height: 0.08 },
  /** ankle rollers behind the lower shins */
  roller: { r: 0.05, half: 0.2 },
  /** thick catch pad in front: the hands land on it */
  catch: { width: 0.9, depth: 0.7, thick: 0.05 },
}

/**
 * Nordic station (fixed): kneeling pad and the ankle roller over the backs of the lower shins. `kneePad` is the pad's
 * top centre, `roller` the roller axle centre.
 */
export function nordicStation(o: { id?: string; kneePad: V3; roller: V3 }): ImplementSpec {
  const { knee, roller } = NORDIC
  const k = o.kneePad, r = o.roller
  return {
    id: o.id ?? 'nordic',
    kind: 'nordic_station',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      box([k[0], k[1] - knee.thick / 2, k[2]], [knee.width, knee.thick, knee.depth]),
      { shape: 'cylinder', a: [-roller.half, r[1], r[2]], b: [roller.half, r[1], r[2]], r: roller.r, pad: true },
    ],
    sites: { knee: { pos: k, normal: [0, 1, 0] }, roller: { pos: r, axis: [1, 0, 0] } },
  }
}

/**
 * thick mat on the floor, top at NORDIC.catch.thick; local origin on the floor under its centre. Not a `pad` part: the
 * hands resting on it get their own tolerance (Setup.rests), which the gate applies to non-pad parts only.
 */
export function catchPad(o: { id?: string } = {}): ImplementSpec {
  const { width, depth, thick } = NORDIC.catch
  return {
    id: o.id ?? 'catch',
    kind: 'catch_pad',
    mass: 0,
    com: [0, 0, 0],
    parts: [box([0, thick / 2, 0], [width, thick, depth], undefined, false)],
    sites: { top: { pos: [0, thick, 0], normal: [0, 1, 0] } },
  }
}

export const SPLIT_BENCH = { length: 1.1, width: 0.28, thick: 0.06, post: 0.05, inset: 0.14, footHalf: 0.2 }

/**
 * Flat bench for the split squat's rear foot, drawn by this family (figure/props/families/legs-knee/bench.ts). The
 * pad is not a `pad` part: the foot resting on it gets its own tolerance (Setup.rests), which the gate applies to
 * non-pad parts only. Origin on the floor under the top edge of the pad's near end, the pad running back (-Z).
 */
export function splitBench(o: { id?: string; height: number }): ImplementSpec {
  const { length: L, width, thick, post, inset, footHalf } = SPLIT_BENCH
  const h = o.height
  const legs = [-inset, -L + inset]
  return {
    id: o.id ?? 'split_bench',
    kind: 'split_bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      box([0, h - thick / 2, -L / 2], [width, thick, L], undefined, false),
      ...legs.map((z): Part => box([0, (h - thick) / 2, z], [post, h - thick, post], undefined, false)),
      ...legs.map((z): Part => box([0, 0.02, z], [2 * footHalf, 0.04, post], undefined, false)),
    ],
    sites: { end: { pos: [0, h, 0], axis: [1, 0, 0] }, top: { pos: [0, h, -L / 2], normal: [0, 1, 0] } },
  }
}

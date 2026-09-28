import { cableHandle, type ImplementSpec, type Part, type Site } from '../implements.ts'
import type { V3 } from '../math.ts'
import { plyoBox } from './shared.ts'

// F6 legs-hip-calf: implement factories (ImplementSpec geometry) for this family's templates. New implement kinds go in
// KINDS, and kinds that move with the hands in MOVING (the equipment-equipment check tests those against everything).
// The drawn machines (src/features/figure/props/families/legs-hip-calf/) share these constants, so contact surfaces
// are drawn exactly where the template puts them.

export const KINDS = ['calf_machine', 'seated_calf', 'hip_machine', 'grab_handle', 'calf_step'] as const
export const MOVING: readonly string[] = []

const cyl = (a: V3, b: V3, r: number, pad?: boolean): Part => ({ shape: 'cylinder', a, b, r, ...(pad ? { pad: true } : {}) })

/**
 * Padded foot bar the forefoot rests on (standing and seated calf machines): the balls of the feet sit on its top
 * line, the heels hang free behind it and the toes drape over its front, which keeps them clear of the bar at the top
 * of the raise. Axis along X, `half` wide.
 */
export const FOOT_BAR = { r: 0.038, half: 0.3 }

/** standing calf machine: bar top height, shoulder pads and the yoke handles (relative to the pad centres) */
export const CALF_STANDING = {
  barTop: 0.16,
  /** `roll` deg: the outer edge dips to follow the trapezius slope */
  pad: { x: 0.16, size: [0.11, 0.07, 0.2] as V3, roll: 15 },
  handle: { x: 0.25, dz: 0.3, top: -0.12, bottom: -0.34, r: 0.016 },
  /** guide rods and carriage in front of the lifter, from the ball line */
  guideZ: 0.5,
}

export function footBar(o: { id: string; kind: 'calf_machine' | 'seated_calf'; top: V3; balls: Record<string, V3> }): ImplementSpec {
  const c: V3 = [o.top[0], o.top[1] - FOOT_BAR.r, o.top[2]]
  const sites: Record<string, Site> = {}
  for (const [k, p] of Object.entries(o.balls)) sites[k] = { pos: p, normal: [0, 1, 0] }
  return {
    id: o.id,
    kind: o.kind,
    mass: 0,
    com: [0, 0, 0],
    parts: [cyl([c[0] - FOOT_BAR.half, c[1], c[2]], [c[0] + FOOT_BAR.half, c[1], c[2]], FOOT_BAR.r, true)],
    sites,
  }
}

/**
 * the standing machine's yoke in its own frame: origin between the shoulder pad bottoms, handles hang from its arms.
 * The pads are not marked padded so the template's girdle rest tolerance applies (a padded part always takes the pad
 * default); the drawn pads come from these boxes all the same.
 */
export function calfYoke(o: { id?: string } = {}): ImplementSpec {
  const { pad, handle } = CALF_STANDING
  const parts: Part[] = []
  const sites: Record<string, Site> = {}
  for (const s of [1, -1]) {
    const h = (-s * pad.roll * Math.PI) / 360
    parts.push({ shape: 'box', center: [s * pad.x, pad.size[1] / 2, 0], size: pad.size, rot: [0, 0, Math.sin(h), Math.cos(h)] })
    parts.push(cyl([s * handle.x, handle.top, handle.dz], [s * handle.x, handle.bottom, handle.dz], handle.r))
    sites[s > 0 ? 'l' : 'r'] = { pos: [s * handle.x, (handle.top + handle.bottom) / 2, handle.dz], axis: [0, 1, 0] }
  }
  return { id: o.id ?? 'yoke', kind: 'calf_machine', mass: 0, com: [0, 0, 0], parts, sites }
}

/** seated calf machine: seat, foot bar and the knee-pad lever pivoting ahead of the knees (lever frame: origin on the
 * pivot); grips stand up from the pad frame either side of the knees */
export const CALF_SEATED = {
  seat: { size: [0.36, 0.07, 0.34] as V3 },
  /** knee pad across both thighs */
  pad: { size: [0.46, 0.07, 0.12] as V3 },
  /** pad frame (a cross tube on the pad's back) half width and thickness */
  frame: { half: 0.3, t: 0.05 },
  handle: { x: 0.25, r: 0.016, from: 0.03, to: 0.16 },
}

/** lever with the pad at `padAt` (rotated `padRot`), grips standing along the pad's up direction */
export function seatedLever(o: { id?: string; padAt: V3; padRot: [number, number, number, number]; up: V3 }): ImplementSpec {
  const { pad, frame, handle } = CALF_SEATED
  const parts: Part[] = [{ shape: 'box', center: o.padAt, size: pad.size, rot: o.padRot, pad: true }]
  const sites: Record<string, Site> = {}
  const base = pad.size[1] / 2 + 0.012 + frame.t
  const at = (x: number, h: number): V3 => [x, o.padAt[1] + o.up[1] * (base + h), o.padAt[2] + o.up[2] * (base + h)]
  for (const s of [1, -1]) {
    const x = s * handle.x
    parts.push(cyl(at(x, handle.from), at(x, handle.to), handle.r))
    sites[s > 0 ? 'l' : 'r'] = { pos: at(x, (handle.from + handle.to) / 2), axis: o.up }
  }
  return { id: o.id ?? 'lever', kind: 'seated_calf', mass: 0, com: [0, 0, 0], parts, sites }
}

/** seated hip abduction / adduction machine: one machine, the leg pads go outside (abduction) or inside the knees */
export const HIP_MACHINE = {
  seat: { size: [0.4, 0.07, 0.42] as V3 },
  back: { size: [0.4, 0.07, 0.62] as V3 },
  /** thigh pad: across (x), tall (y), along the thigh (z) */
  pad: { size: [0.06, 0.18, 0.16] as V3 },
  /** foot rest under the ball of the foot */
  peg: { r: 0.022, half: 0.07 },
  handle: { r: 0.016, len: 0.16 },
  /** arm tube below the hip joint, m */
  armDrop: 0.21,
}

const Q = (q: [number, number, number, number] | undefined) => (q ? { rot: q } : {})

/** seat, back pad and side handles (world frame); handles run along Z beside the hips */
export function hipSeat(o: { seat: Part; back: Part; handles: Record<'l' | 'r', V3> }): ImplementSpec {
  const { handle } = HIP_MACHINE
  const parts: Part[] = [o.seat, o.back]
  const sites: Record<string, Site> = {}
  for (const side of ['l', 'r'] as const) {
    const h = o.handles[side]
    parts.push(cyl([h[0], h[1], h[2] - handle.len / 2], [h[0], h[1], h[2] + handle.len / 2], handle.r))
    sites[side] = { pos: h, axis: [0, 0, 1] }
  }
  return { id: 'hip_seat', kind: 'hip_machine', mass: 0, com: [0, 0, 0], parts, sites }
}

/** a leg arm in its own frame (origin on the hip joint centre, turning about Y with the thigh): thigh pad and foot
 * rest; the foot contact site sits on the rest's top */
export function hipArm(o: { id: string; side: 'l' | 'r'; padAt: V3; padRot?: [number, number, number, number]; ball: V3 }): ImplementSpec {
  const { pad, peg } = HIP_MACHINE
  const c: V3 = [o.ball[0], o.ball[1] - peg.r, o.ball[2]]
  return {
    id: o.id,
    kind: 'hip_machine',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      { shape: 'box', center: o.padAt, size: pad.size, pad: true, ...Q(o.padRot) },
      cyl([c[0] - peg.half, c[1], c[2]], [c[0] + peg.half, c[1], c[2]], peg.r, true),
    ],
    sites: { [`ball_${o.side}`]: { pos: o.ball, normal: [0, 1, 0] } },
  }
}

/** a short vertical grab handle on a bracket off a machine upright; local origin at the grip centre, `back` points
 * from the grip to the upright */
export const GRAB = { r: 0.016, len: 0.2, arm: 0.1 }

export function grabHandle(o: { id?: string; back: V3; arm?: number }): ImplementSpec {
  const h = GRAB.len / 2
  const arm = o.arm ?? GRAB.arm
  const b: V3 = [o.back[0] * arm, o.back[1] * arm, o.back[2] * arm]
  return {
    id: o.id ?? 'grab',
    kind: 'grab_handle',
    mass: 0,
    com: [0, 0, 0],
    parts: [cyl([0, -h, 0], [0, h, 0], GRAB.r), cyl([0, h - 0.02, 0], [b[0], h - 0.02 + b[1], b[2]], 0.014), cyl([0, -h + 0.02, 0], [b[0], -h + 0.02 + b[1], b[2]], 0.014)],
    sites: { h: { pos: [0, 0, 0], axis: [0, 1, 0] } },
  }
}

/**
 * Cable ankle strap: drawn as the core ankle_strap attachment (props/cable.ts), cuff centred on site c. The cuff wraps
 * the lower shank, so only the carabiner and tab above it collide.
 */
export function ankleStrap(o: { id?: string } = {}): ImplementSpec {
  const s = cableHandle({ id: o.id ?? 'strap', attachment: 'ankle_strap' })
  return { ...s, parts: [cyl([0, -0.004, 0], [0, 0.05, 0], 0.012)] }
}

/** cuff centre above the ankle joint along the shank, m */
export const STRAP_ABOVE_ANKLE = 0.085

/**
 * The shared plyo box as a calf-raise step. The forefoot capsule is rigid with the foot while the toes extend flat on
 * the tread at the top of a raise, so the box is collided once, as this implement, where the template's rest tolerance
 * for the standing foot applies (the tread is not marked padded, which would override it); the drawn box does not
 * collide again.
 */
export function calfStep(o: { id?: string; height: number }): ImplementSpec {
  const box = plyoBox(o)
  return { ...box, kind: 'calf_step', parts: box.parts.map((p) => ({ ...p, pad: false })) }
}

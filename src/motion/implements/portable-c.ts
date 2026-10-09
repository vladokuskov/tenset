import { siteWorld, type ImplementSpec, type Part } from '../implements.ts'
import { add, cross, dot, len, norm, qalign, qrot, scale, sub, type V3 } from '../math.ts'
import type { ImplementPose } from '../skeleton.ts'
import type { BandPoint } from './bands.ts'
import { plateStack } from './free-weights.ts'

// Portable equipment for the tier C templates (wave 3c): gymnastic rings on straps from an overhead anchor, the
// landmine (floor pivot plus a barbell pivoting in it) and the ab wheel. The figure props
// (src/features/figure/props/portable-c.ts) draw them from these descriptors, so grip sites and contact surfaces match.

export const KINDS = ['gym_ring', 'ring_strap', 'ring_anchor', 'landmine', 'landmine_bar', 'ab_wheel'] as const
export const MOVING: readonly string[] = ['gym_ring', 'landmine_bar', 'ab_wheel']

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

// ---------- gymnastic rings ----------

/**
 * Rings (m): `R` ring centre-line radius, `r` tube radius (18 cm inside, 28 mm section), strap width and thickness, the
 * anchor's default height and strap spacing, the rig beam section and the uprights' half spacing.
 */
export const RING = { R: 0.104, r: 0.014, segments: 12, strap: { width: 0.038, thick: 0.003 }, anchorHeight: 2.75, spread: 0.5, beam: 0.08, upright: 0.75 }

/** grip heights above the floor (bottom of the ring, m) per use: the template sets the ring there, the strap follows */
export const RING_HEIGHT = { push_up: 0.12, row: 1.0, triceps_extension: 1.1, dip: 1.25, pull_up: 2.25 } as const

/**
 * One gymnastic ring. Local frame: ring centre at the origin, the ring in the XY plane (faces normal to Z), the strap at
 * the top (+Y). Parts: a ring of thin cylinders (radius r), so a hand closing on it is a hand on a handle for the gates.
 * Sites: `grip` (bottom of the ring, axis X: the hand hangs from or presses on it), `strap` (top outer edge, the strap's
 * path point), `c` (centre). Pose it with `ringPose(spec, hand, axis, strapTop)`.
 */
export function gymRing(o: { id: string }): ImplementSpec {
  const { R, r, segments: n } = RING
  const half = R * Math.tan(Math.PI / n)
  const parts: Part[] = []
  for (let k = 0; k < n; k++) {
    // a segment centred on the bottom (k = 0 at -Y) so the grip site sits on a segment axis
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n
    const c: V3 = [R * Math.cos(a), R * Math.sin(a), 0]
    const t: V3 = [-Math.sin(a), Math.cos(a), 0]
    parts.push(cyl([c[0] - t[0] * half, c[1] - t[1] * half, 0], [c[0] + t[0] * half, c[1] + t[1] * half, 0], r))
  }
  return {
    id: o.id,
    kind: 'gym_ring',
    mass: 0.4,
    com: [0, 0, 0],
    parts,
    sites: { grip: { pos: [0, -R, 0], axis: [1, 0, 0] }, strap: { pos: [0, R + r, 0] }, c: { pos: [0, 0, 0] } },
  }
}

export type RingAnchorMount = 'beam' | 'rig'
export type RingAnchorSpec = ImplementSpec & { kind: 'ring_anchor'; mount: RingAnchorMount; whole: boolean }

export const isRingAnchor = (s: ImplementSpec): s is RingAnchorSpec => s.kind === 'ring_anchor' && 'mount' in s

/**
 * Overhead anchor for the ring straps. Local origin on the floor under the beam centre; the beam runs along X at
 * `height` (its centre line). `mount: 'rig'` (default) adds two uprights at x = +-RING.upright down to floor feet,
 * 'beam' draws the crossbar alone (it is usually above the frame). `whole`: the camera frames it base to top (pull-ups);
 * otherwise only its floor feet are framed. Sites `strap_l` / `strap_r` (under the beam, `spread` apart: the straps'
 * top path points).
 */
export function ringAnchor(o: { id?: string; height?: number; spread?: number; mount?: RingAnchorMount; whole?: boolean } = {}): RingAnchorSpec {
  const h = o.height ?? RING.anchorHeight, s = (o.spread ?? RING.spread) / 2, mount = o.mount ?? 'rig'
  const { beam: b, upright: u } = RING
  const parts: Part[] = [{ shape: 'box', center: [0, h, 0], size: [2 * u + b, b, b] }]
  if (mount === 'rig') for (const x of [u, -u]) parts.push({ shape: 'box', center: [x, (h - b / 2) / 2, 0], size: [b, h - b / 2, b] }, { shape: 'box', center: [x, 0.006, 0], size: [b, 0.012, 0.9] })
  return {
    id: o.id ?? 'rings',
    kind: 'ring_anchor',
    mount,
    whole: o.whole ?? false,
    mass: 0,
    com: [0, 0, 0],
    parts,
    sites: { strap_l: { pos: [s, h - b / 2, 0] }, strap_r: { pos: [-s, h - b / 2, 0] } },
  }
}

export type StrapData = { path: BandPoint[]; width: number; thick: number }
export type RingStrapSpec = ImplementSpec & { kind: 'ring_strap'; strap: StrapData }

export const isRingStrap = (s: ImplementSpec): s is RingStrapSpec => s.kind === 'ring_strap' && 'strap' in s

/**
 * A ring strap: no parts (never collided or framed), drawn taut every frame through `path` (anchor site to the ring's
 * `strap` site, as `band` paths: implement, optional site and offset). Pose it with `bandPose(id)`.
 */
export function ringStrap(o: { id: string; path: (string | BandPoint)[] }): RingStrapSpec {
  return {
    id: o.id,
    kind: 'ring_strap',
    mass: 0,
    com: [0, 0, 0],
    parts: [],
    sites: {},
    strap: { path: o.path.map((p) => (typeof p === 'string' ? { implement: p } : p)), width: RING.strap.width, thick: RING.strap.thick },
  }
}

/**
 * Pose a ring hanging from its strap: the grip at `hand`, the ring's +Y along the strap towards `top` (the anchor's
 * strap point, world) and its grip axis as close to `axis` as that allows (the ring turns in the hand to follow the
 * strap).
 */
export function ringPose(spec: ImplementSpec, hand: V3, axis: V3, top: V3): ImplementPose {
  const up = norm(sub(top, hand))
  const a = sub(axis, scale(up, dot(axis, up)))
  const rot = qalign([1, 0, 0], [0, 1, 0], len(a) > 1e-6 ? norm(a) : cross(up, [0, 0, 1]), up)
  return { id: spec.id, pos: sub(hand, qrot(rot, spec.sites.grip.pos)), rot }
}

/** both rings with their straps on one anchor (default id `rings`): rings `ring_l` / `ring_r` (prefix `ring`), straps `strap_l` / `strap_r` */
export function gymRings(o: { anchor?: string; ring?: string } = {}): ImplementSpec[] {
  const a = o.anchor ?? 'rings', r = o.ring ?? 'ring'
  return (['l', 'r'] as const).flatMap((s) => [
    gymRing({ id: `${r}_${s}` }),
    ringStrap({ id: `strap_${s}`, path: [{ implement: a, site: `strap_${s}` }, { implement: `${r}_${s}`, site: 'strap' }] }),
  ])
}

/** the strap path in world space for one frame */
export function strapPath(spec: RingStrapSpec, specs: ReadonlyMap<string, ImplementSpec>, poses: ReadonlyMap<string, ImplementPose>): V3[] {
  return spec.strap.path.map((p) => {
    const s = specs.get(p.implement), pose = poses.get(p.implement)
    if (!s || !pose) throw new Error(`strap ${spec.id}: no implement ${p.implement}`)
    const site = p.site ? s.sites[p.site] : undefined
    if (p.site && !site) throw new Error(`strap ${spec.id}: ${p.implement} has no site ${p.site}`)
    return add(pose.pos, qrot(pose.rot, add(site?.pos ?? [0, 0, 0], p.at ?? [0, 0, 0])))
  })
}

// ---------- landmine ----------

/**
 * Landmine (m): the pivot centre's height above the floor, the floor plate, the post, the socket under the pivot ball,
 * and the swivel sleeve the bar end sits in (it turns with the bar, so it is part of the bar). `barOffset`: the bar end
 * inside the sleeve, from the pivot.
 */
export const LANDMINE = {
  pivot: 0.12,
  base: { size: 0.42, thick: 0.012 },
  post: 0.07,
  socket: { r: 0.04, top: 0.03, h: 0.03 },
  ball: 0.04,
  sleeve: { from: 0.045, to: 0.32, r: 0.036 },
  barOffset: 0.04,
}

/** Olympic bar dimensions as on `barbell` (implements.ts): half shaft, collar width, sleeve end, plates start */
const BAR = { length: 2.2, shaft: 0.655, collar: 0.015, sleeveR: 0.025, collarR: 0.04, shaftR: 0.014, plate: 0.665 }

/**
 * Landmine floor unit. Local origin on the floor under the pivot; parts: the floor plate, the post and the socket under
 * the pivot ball. Site `pivot` (the bar's pivot point, LANDMINE.pivot above the floor).
 */
export function landmine(o: { id?: string } = {}): ImplementSpec {
  const { pivot, base, post, socket } = LANDMINE
  const top = pivot - socket.top
  return {
    id: o.id ?? 'landmine',
    kind: 'landmine',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      { shape: 'box', center: [0, base.thick / 2, 0], size: [base.size, base.thick, base.size] },
      { shape: 'box', center: [0, (base.thick + top - socket.h) / 2, 0], size: [post, top - socket.h - base.thick, post] },
      cyl([0, top - socket.h, 0], [0, top, 0], socket.r),
    ],
    sites: { pivot: { pos: [0, pivot, 0] } },
  }
}

export type LandmineHandle = 'none' | 'v'

/**
 * A barbell with one end in the landmine sleeve; it moves as a rigid body about the pivot. Local frame: origin at the
 * pivot, the bar along +X towards the free end, plates (`plateKg` per the free end, as on the barbell) on the free
 * sleeve only. Parts: the swivel sleeve, the bar (inner sleeve, collars, shaft, outer sleeve) and the plates.
 * Sites (grip axes little finger to index):
 * - `end` / `end_in`: one hand round the free sleeve 7 cm from its tip, axis +X / -X (index towards the tip / the pivot)
 * - `cup_l` / `cup_r`: both hands cupped round the tip (the composer gives a goblet hand), sides named for the press
 *   pose (local +X towards the lifter: yaw 180, so local +Z is the lifter's left)
 * - with `handle: 'v'`: `v_l` / `v_r`, a close-grip V-handle hooked under the shaft about 20 cm inside the free end's
 *   inner collar (LANDMINE_V.inset), handles along the bar
 *   (neutral grip, axis +X), sides named for the row pose (bar running forward from the pivot behind: yaw 0, so local -Z
 *   is the lifter's left)
 * - `tip` (centre of the sleeve end face, normal +X)
 */
export function landmineBar(o: { id?: string; plateKg?: number; handle?: LandmineHandle } = {}): ImplementSpec {
  const plate = o.plateKg ?? 20
  const { sleeve, barOffset: x0 } = LANDMINE
  const mid = x0 + BAR.length / 2
  const tip = x0 + BAR.length
  const parts: Part[] = [cyl([sleeve.from, 0, 0], [sleeve.to, 0, 0], sleeve.r), cyl([mid - BAR.shaft, 0, 0], [mid + BAR.shaft, 0, 0], BAR.shaftR)]
  for (const s of [1, -1]) {
    parts.push(cyl([mid + s * BAR.shaft, 0, 0], [mid + (s * BAR.length) / 2, 0, 0], BAR.sleeveR))
    parts.push(cyl([mid + s * (BAR.shaft - BAR.collar), 0, 0], [mid + s * BAR.shaft, 0, 0], BAR.collarR))
  }
  for (const p of plateStack(plate, mid + BAR.plate)) parts.push(cyl([p.from, 0, 0], [p.to, 0, 0], p.r))
  const e = tip - 0.07
  const sites: ImplementSpec['sites'] = {
    end: { pos: [e, 0, 0], axis: [1, 0, 0] },
    end_in: { pos: [e, 0, 0], axis: [-1, 0, 0] },
    cup_l: { pos: [tip - 0.05, 0, 0.03], axis: [0, 1, 0] },
    cup_r: { pos: [tip - 0.05, 0, -0.03], axis: [0, 1, 0] },
    tip: { pos: [tip, 0, 0], normal: [1, 0, 0] },
  }
  if (o.handle === 'v') {
    const v = LANDMINE_V, hx = mid + BAR.shaft - BAR.collar - v.inset
    // a short strut under the hook, two arms down to the grips' ends nearer the pivot, the grips along the bar
    parts.push(cyl([hx, -BAR.shaftR, 0], [hx, -v.neck, 0], v.r))
    for (const z of [v.half, -v.half]) parts.push(cyl([hx, -v.neck, 0], [hx - v.grip, -v.drop, z], v.r), cyl([hx - v.grip, -v.drop, z], [hx + v.grip, -v.drop, z], v.gripR))
    sites.v_l = { pos: [hx, -v.drop, -v.half], axis: [1, 0, 0] }
    sites.v_r = { pos: [hx, -v.drop, v.half], axis: [1, 0, 0] }
  }
  return { id: o.id ?? 'bar', kind: 'landmine_bar', mass: 20 + plate + (o.handle === 'v' ? 2 : 0), com: [mid + (plate * (BAR.plate + 0.05)) / (20 + plate), 0, 0], parts, sites }
}

/** close-grip V-handle under the landmine bar: inset from the free end's inner collar, strut length, drop to the grips,
 * half spacing, grip half length and radius, frame radius. Hooked 20 cm inside the collar with a 9 cm drop (T-bar row,
 * 316): nearer the plates or lower, the plates and shaft meet the chest with the elbows still ~90 deg and in front of
 * the trunk */
export const LANDMINE_V = { inset: 0.2, neck: 0.05, drop: 0.09, half: 0.06, grip: 0.06, gripR: 0.015, r: 0.012 }

/**
 * Pose of a landmine bar pivoting at `pivot` (world): `yaw` deg about +Y with 0 = the bar running towards +Z (forward)
 * from the pivot and 180 = towards -Z (back at a lifter facing the pivot), `pitch` deg above horizontal. The bar does not
 * roll: local +Y stays in the vertical plane through the bar.
 */
export function landminePose(id: string, pivot: V3, yaw: number, pitch: number): ImplementPose {
  const y = (yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180
  const dir: V3 = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)]
  return { id, pos: pivot, rot: qalign([1, 0, 0], [0, 1, 0], dir, [0, 1, 0]) }
}

/** the pitch (deg) that puts `site` of a landmine bar at height `y` (world) at this yaw, or null when out of reach */
export function landminePitchFor(spec: ImplementSpec, site: string, pivot: V3, yaw: number, y: number): number | null {
  const at = (p: number) => siteWorld(spec, landminePose(spec.id, pivot, yaw, p), site).pos[1]
  let lo = -30, hi = 85
  if ((at(lo) - y) * (at(hi) - y) > 0) return null
  for (let k = 0; k < 50; k++) {
    const m = (lo + hi) / 2
    if ((at(m) - y) * (at(lo) - y) <= 0) hi = m
    else lo = m
  }
  return (lo + hi) / 2
}

// ---------- ab wheel ----------

/** ab wheel (m): tyre radius, wheel width, axle radius, handle span along the axle and handle radius */
export const AB_WHEEL = { R: 0.09, width: 0.07, axle: 0.009, handle: { from: 0.05, to: 0.17, r: 0.016 } }

/**
 * Ab wheel: one wheel on an axle along X with a handle each side. Local origin at the axle centre: on the floor the pose
 * puts it AB_WHEEL.R up with the axle level, and the wheel rolls along local Z (the drawn tyre turns by the distance the
 * origin travels along it). Sites `l` / `r` (handle centres at +-X, axis +X, left hand on +X), `floor` (the contact
 * point, normal -Y), `c`.
 */
export function abWheel(o: { id?: string } = {}): ImplementSpec {
  const { R, width: w, axle, handle: h } = AB_WHEEL
  const hc = (h.from + h.to) / 2
  return {
    id: o.id ?? 'wheel',
    kind: 'ab_wheel',
    mass: 1.2,
    com: [0, 0, 0],
    parts: [cyl([-w / 2, 0, 0], [w / 2, 0, 0], R), cyl([-h.from, 0, 0], [h.from, 0, 0], axle), cyl([h.from, 0, 0], [h.to, 0, 0], h.r), cyl([-h.from, 0, 0], [-h.to, 0, 0], h.r)],
    sites: { l: { pos: [hc, 0, 0], axis: [1, 0, 0] }, r: { pos: [-hc, 0, 0], axis: [1, 0, 0] }, floor: { pos: [0, -R, 0], normal: [0, -1, 0] }, c: { pos: [0, 0, 0] } },
  }
}

/** pose of an ab wheel on the floor: axle centre over (x, z), rolling along `heading` deg (0 = +Z, positive towards +X) */
export function abWheelPose(id: string, x: number, z: number, heading = 0): ImplementPose {
  const h = (heading * Math.PI) / 180
  return { id, pos: [x, AB_WHEEL.R, z], rot: qalign([0, 0, 1], [0, 1, 0], norm([Math.sin(h), 0, Math.cos(h)]), [0, 1, 0]) }
}

/** wheel spin (rad about local X) for a pose: the distance its origin has travelled along local Z over the radius */
export function abWheelSpin(pose: ImplementPose): number {
  const fwd = qrot(pose.rot, [0, 0, 1])
  return (pose.pos[0] * fwd[0] + pose.pos[2] * fwd[2]) / AB_WHEEL.R
}

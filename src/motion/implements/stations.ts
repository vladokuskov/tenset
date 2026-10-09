import type { ImplementSpec, Part, Site } from '../implements.ts'
import { add, DEG, norm, qaxis, qid, qmul, qrot, scale, sub, type Quat, type V3 } from '../math.ts'
import type { ImplementPose } from '../skeleton.ts'

// Fixed machine stations for the tier C exercises (wave 3c): GHD, hack squat, pendulum squat, belt squat, preacher
// bench, chest-supported T-bar, captain's chair, decline bench with leg hooks, raised seal-row bench and reverse hyper.
// Each factory returns the contact surfaces (pads, rollers, plates, handles) as parts with sites; the figure props
// (src/features/figure/props/stations.ts) draw the frames round exactly these parts, so what the gates collide with is
// what is drawn. Frames: X across, Y up, +Z the way the lifter faces unless a factory says otherwise; origin on the
// floor. Moving parts (sled, swing arm, levers) are their own implements with the local origin on their pivot or rail;
// pose them with `leverPose` / `sledPose`.
//
// The free T-bar row (316) uses the landmine from implements/portable-c.ts (`landmine()` plus
// `landmineBar({ handle: 'v' })`), which already pivots on the floor and carries a V-handle under the loaded end.
// The incline machine press (122) reuses the chest press (implements/press-horizontal.ts) with its lever pivot moved
// forward and down: see `inclinePressLever`.

export const KINDS = [
  'ghd',
  'hack_squat',
  'hack_sled',
  'pendulum_squat',
  'pendulum_arm',
  'belt_squat',
  'belt_lever',
  'hip_belt',
  'preacher_bench',
  'tbar_station',
  'tbar_lever',
  'captains_chair',
  'decline_bench',
  'seal_bench',
  'reverse_hyper',
  'hyper_lever',
] as const
/** the hack sled, pendulum arm and T-bar lever carry the handles the hands hold */
export const MOVING: readonly string[] = ['hack_sled', 'pendulum_arm', 'tbar_lever']

const cyl = (a: V3, b: V3, r: number, pad = false): Part => ({ shape: 'cylinder', a, b, r, ...(pad ? { pad: true } : {}) })
const box = (center: V3, size: V3, rot?: Quat, pad = false): Part => ({ shape: 'box', center, size, ...(rot ? { rot } : {}), ...(pad ? { pad: true } : {}) })
/** rotation about +X by `deg`: +Y turns towards +Z, +Z towards -Y */
export const rotX = (deg: number): Quat => qaxis([1, 0, 0], deg * DEG)
const X: V3 = [1, 0, 0]
const UP: V3 = [0, 1, 0]
const spec = (id: string, kind: ImplementSpec['kind'], parts: Part[], sites: Record<string, Site>, mass = 0): ImplementSpec => ({ id, kind, mass, com: [0, 0, 0], parts, sites })

/** a part moved by rotation `q` then translation `t` */
function movePart(p: Part, q: Quat, t: V3): Part {
  if (p.shape === 'cylinder') return { ...p, a: add(t, qrot(q, p.a)), b: add(t, qrot(q, p.b)) }
  return { ...p, center: add(t, qrot(q, p.center)), rot: qmul(q, p.rot ?? qid()) }
}

function moveSite(s: Site, q: Quat, t: V3): Site {
  return { pos: add(t, qrot(q, s.pos)), ...(s.axis ? { axis: qrot(q, s.axis) } : {}), ...(s.normal ? { normal: qrot(q, s.normal) } : {}) }
}

/** pose of a lever whose local origin is its pivot (`pivot` in the frame) turned `deg` about X, in a frame posed at `frame` */
export function leverPose(id: string, pivot: V3, deg: number, frame: { pos: V3; rot: Quat } = { pos: [0, 0, 0], rot: qid() }): ImplementPose {
  return { id, pos: add(frame.pos, qrot(frame.rot, pivot)), rot: qmul(frame.rot, rotX(deg)) }
}

// ---------- shoulder carriage (hack sled, pendulum arm) ----------

/**
 * Back pad with shoulder pads and side handles. Carriage frame: X across, Y out of the back pad towards the lifter,
 * Z down the pad (towards the feet); origin on the pad surface on the shoulder line (the shoulder pads' undersides).
 * The same pads serve facing the pad (reverse hack): the chest on the back pad, the shoulder pads on the shoulders.
 */
export const CARRIAGE = {
  back: { width: 0.38, thick: 0.07, from: -0.3, to: 0.5 },
  shoulder: { x: 0.17, size: [0.12, 0.13, 0.11] as V3 },
  handle: { x: 0.31, r: 0.016, len: 0.14, z: -0.05, out: 0.03 },
}

function carriageParts(): { parts: Part[]; sites: Record<string, Site> } {
  const { back, shoulder: sh, handle: h } = CARRIAGE
  const parts: Part[] = [box([0, -back.thick / 2, (back.from + back.to) / 2], [back.width, back.thick, back.to - back.from], undefined, true)]
  const sites: Record<string, Site> = { back: { pos: [0, 0, 0.25], normal: [0, 1, 0], axis: [0, 0, 1] } }
  for (const [s, k] of [[1, 'l'], [-1, 'r']] as const) {
    parts.push(box([s * sh.x, sh.size[1] / 2, -sh.size[2] / 2], sh.size, undefined, true))
    sites[`shoulder_${k}`] = { pos: [s * sh.x, sh.size[1] / 2, 0], normal: [0, 0, 1] }
  }
  for (const [s, k] of [[1, 'l'], [-1, 'r']] as const) {
    parts.push(cyl([s * h.x, h.out, h.z], [s * h.x, h.out + h.len, h.z], h.r))
    sites[`handle_${k}`] = { pos: [s * h.x, h.out + h.len / 2, h.z], axis: [0, 1, 0] }
  }
  return { parts, sites }
}

// ---------- GHD ----------

/**
 * Glute-ham developer. Frame: +Z from the foot plate towards the thigh pad (the head end for the back extension and the
 * glute-ham raise; the sit-up faces the other way, seated on the pad); origin on the floor under the foot plate face.
 * Pad: a round nose (cylinder across X) with a flat rear section, top at `padTop`; `reach` is the horizontal distance
 * from the plate face to the front of the nose (the adjustable pad distance). Foot plate: upright, facing +Z. Ankle
 * rollers clamp the lower legs above and below the `ankle` line, `gap` apart (surface to surface).
 */
export const GHD = {
  pad: { r: 0.11, width: 0.44, depth: 0.22, thick: 0.12 },
  plate: { width: 0.36, height: 0.3, thick: 0.03 },
  roller: { r: 0.045, half: 0.16 },
  padTop: 0.98,
  reach: { min: 0.6, max: 0.95, default: 0.78 },
  gap: 0.09,
}

export function ghd(o: { id?: string; padTop?: number; reach?: number; ankle?: { z: number; y: number }; gap?: number } = {}): ImplementSpec {
  const { pad, plate, roller } = GHD
  const top = o.padTop ?? GHD.padTop
  const reach = Math.min(GHD.reach.max, Math.max(GHD.reach.min, o.reach ?? GHD.reach.default))
  const ankle = o.ankle ?? { z: 0.09, y: top + 0.01 }
  const gap = o.gap ?? GHD.gap
  const noseZ = reach - pad.r
  const plateY = ankle.y - 0.06
  const hi: V3 = [0, ankle.y + gap / 2 + roller.r, ankle.z]
  const lo: V3 = [0, ankle.y - gap / 2 - roller.r, ankle.z]
  const across = (c: V3) => cyl([-roller.half, c[1], c[2]], [roller.half, c[1], c[2]], roller.r, true)
  const s45 = Math.SQRT1_2
  return spec(o.id ?? 'ghd', 'ghd', [
    cyl([-pad.width / 2, top - pad.r, noseZ], [pad.width / 2, top - pad.r, noseZ], pad.r, true),
    box([0, top - pad.thick / 2, noseZ - pad.depth / 2], [pad.width, pad.thick, pad.depth], undefined, true),
    box([0, plateY, -plate.thick / 2], [plate.width, plate.height, plate.thick], undefined, true),
    across(hi),
    across(lo),
  ], {
    pad: { pos: [0, top, noseZ - pad.depth / 2], normal: UP, axis: [0, 0, 1] },
    nose: { pos: [0, top - pad.r + pad.r * s45, noseZ + pad.r * s45], normal: [0, s45, s45], axis: X },
    plate: { pos: [0, plateY, 0], normal: [0, 0, 1] },
    roller_top: { pos: hi, axis: X },
    roller_low: { pos: lo, axis: X },
  })
}

// ---------- hack squat ----------

/**
 * Hack squat. Frame (fixed): origin on the floor under the foot plate centre, the lifter facing +Z on the regular hack
 * (back on the pad) and -Z on the reverse hack (chest on the pad). The rails rise towards -Z at `angle` above the
 * floor; the sled (hackSled, the shoulder carriage) slides up them from `bottom`, its carriage origin (shoulder line on
 * the pad surface) at travel 0. The foot plate's surface centre is `plate`, toes-up tilt `plateTilt`.
 * Sites: `plate` (surface centre, normal), `rail` (the carriage origin at travel 0, axis up the rails).
 */
export const HACK = {
  angle: 45,
  plateTilt: 20,
  plate: { width: 0.78, depth: 0.56, thick: 0.03, at: [0, 0.2, 0.3] as V3 },
  bottom: [0, 0.92, -0.25] as V3,
  /** sled travel up the rails from `bottom`, m */
  travel: 0.75,
  /** rail centre-lines: |x|, distance behind the pad surface, extent below travel 0 and above full travel */
  rail: { x: 0.32, drop: 0.2, below: 0.12, above: 0.28 },
}

export function hackFrame(angle = HACK.angle) {
  const a = angle * DEG
  /** up the rails */
  const up: V3 = [0, Math.sin(a), -Math.cos(a)]
  /** pad normal, towards the lifter */
  const normal: V3 = [0, Math.cos(a), Math.sin(a)]
  return { up, normal, rot: rotX(angle) }
}

export function hackSquat(o: { id?: string; angle?: number; plateTilt?: number; plate?: V3; bottom?: V3 } = {}): ImplementSpec {
  const angle = o.angle ?? HACK.angle
  const t = o.plateTilt ?? HACK.plateTilt
  const p = o.plate ?? HACK.plate.at
  const { width, depth, thick } = HACK.plate
  const rot = rotX(-t)
  const n = qrot(rot, UP)
  return spec(o.id ?? 'hack', 'hack_squat', [box(add(p, scale(n, -thick / 2)), [width, thick, depth], rot, true)], {
    plate: { pos: p, normal: n, axis: X },
    rail: { pos: o.bottom ?? HACK.bottom, axis: hackFrame(angle).up },
  })
}

/** the sled: the shoulder carriage (CARRIAGE), local frame = carriage frame */
export function hackSled(o: { id?: string } = {}): ImplementSpec {
  const { parts, sites } = carriageParts()
  return spec(o.id ?? 'hack_sled', 'hack_sled', parts, sites)
}

/** sled pose `travel` m up the rails of a hack frame `frame` (its spec), the frame posed at `at` */
export function sledPose(id: string, frame: ImplementSpec, travel: number, at: { pos: V3; rot: Quat } = { pos: [0, 0, 0], rot: qid() }): ImplementPose {
  const rail = frame.sites.rail
  const up = rail.axis!
  const angle = Math.atan2(up[1], -up[2]) / DEG
  return { id, pos: add(at.pos, qrot(at.rot, add(rail.pos, scale(up, travel)))), rot: qmul(at.rot, rotX(angle)) }
}

// ---------- pendulum squat ----------

/**
 * Pendulum squat. Frame (fixed): origin on the floor under the platform centre, the lifter facing +Z; the pivot sits
 * behind and above the head on a rear tower. Platform: toes-up `tilt`, surface centre `platform`. The arm
 * (pendulumArm) hangs from the pivot to the shoulder carriage; turning it about X swings the pads on an arc round the
 * pivot (positive deg swings them down and back, the descent). Sites: `platform`, `pivot` (axis X).
 */
export const PENDULUM = {
  pivot: [0, 1.95, -0.78] as V3,
  /** carriage origin (shoulder line on the back pad) at the arm's rest pose */
  shoulder: [0, 1.4, -0.16] as V3,
  /** back pad lean from vertical, deg */
  lean: 18,
  platform: { width: 0.72, depth: 0.56, thick: 0.03, tilt: 25, at: [0, 0.2, 0.22] as V3 },
}

export function pendulumSquat(o: { id?: string; pivot?: V3; platform?: V3; tilt?: number } = {}): ImplementSpec {
  const { width, depth, thick } = PENDULUM.platform
  const t = o.tilt ?? PENDULUM.platform.tilt
  const p = o.platform ?? PENDULUM.platform.at
  const rot = rotX(-t)
  const n = qrot(rot, UP)
  return spec(o.id ?? 'pendulum', 'pendulum_squat', [box(add(p, scale(n, -thick / 2)), [width, thick, depth], rot, true)], {
    platform: { pos: p, normal: n, axis: X },
    pivot: { pos: o.pivot ?? PENDULUM.pivot, axis: X },
  })
}

/** the swing arm: local origin at the pivot; the carriage at `shoulder` (frame coords at rest) leaning `lean` deg back */
export function pendulumArm(o: { id?: string; pivot?: V3; shoulder?: V3; lean?: number } = {}): ImplementSpec {
  const pivot = o.pivot ?? PENDULUM.pivot
  const q = rotX(90 - (o.lean ?? PENDULUM.lean))
  const t = sub(o.shoulder ?? PENDULUM.shoulder, pivot)
  const c = carriageParts()
  const sites = Object.fromEntries(Object.entries(c.sites).map(([k, s]) => [k, moveSite(s, q, t)]))
  return spec(o.id ?? 'pendulum_arm', 'pendulum_arm', c.parts.map((p) => movePart(p, q, t)), { ...sites, carriage: { pos: t, axis: qrot(q, [0, 0, 1]), normal: qrot(q, UP) } })
}

// ---------- belt squat ----------

/**
 * Belt squat. Frame (fixed): origin on the floor under the middle of the deck, the lifter facing +Z, standing on the
 * two deck halves either side of a slot the lever rides in, holding a grab bar in front. The lever (beltLever) pivots
 * at the front low and runs back under the deck to the chain hook under the hips; the chain rises through the slot to
 * the hip belt (hipBelt, posed with the pelvis). Sites: `deck` (top centre, over the slot), `deck_l` / `deck_r` (top
 * centre of each half, under the feet), `handle_l` / `handle_r` (grab bar, axis X), `pivot` (axis X).
 */
export const BELT_SQUAT = {
  deck: { half: 0.46, slot: 0.075, depth: 0.72, top: 0.24, thick: 0.03 },
  bar: { y: 1.08, z: 0.62, half: 0.34, r: 0.017, grip: 0.22 },
  pivot: [0, 0.32, 1.02] as V3,
  /** chain hook at the lever's rest pose (frame coords) */
  hook: [0, 0.12, -0.02] as V3,
  /** lever turn from rest that lifts the hook by about a squat's hip rise (deg; positive raises the hook) */
  lift: 22,
}

export function beltSquat(o: { id?: string; deckTop?: number; bar?: { y: number; z: number }; pivot?: V3 } = {}): ImplementSpec {
  const { deck, bar } = BELT_SQUAT
  const top = o.deckTop ?? deck.top
  const b = { ...bar, ...o.bar }
  const w = deck.half - deck.slot
  const parts: Part[] = []
  for (const s of [1, -1]) parts.push(box([s * (deck.slot + w / 2), top - deck.thick / 2, 0], [w, deck.thick, deck.depth], undefined, true))
  parts.push(cyl([-b.half, b.y, b.z], [b.half, b.y, b.z], b.r))
  return spec(o.id ?? 'belt_squat', 'belt_squat', parts, {
    deck: { pos: [0, top, 0], normal: UP },
    deck_l: { pos: [deck.slot + w / 2, top, 0], normal: UP },
    deck_r: { pos: [-deck.slot - w / 2, top, 0], normal: UP },
    handle_l: { pos: [b.grip, b.y, b.z], axis: X },
    handle_r: { pos: [-b.grip, b.y, b.z], axis: X },
    pivot: { pos: o.pivot ?? BELT_SQUAT.pivot, axis: X },
  })
}

/** lever: local origin at the pivot, the chain hook at `hook` (frame coords at rest); no contact parts */
export function beltLever(o: { id?: string; pivot?: V3; hook?: V3 } = {}): ImplementSpec {
  const pivot = o.pivot ?? BELT_SQUAT.pivot
  return spec(o.id ?? 'belt_lever', 'belt_lever', [], { hook: { pos: sub(o.hook ?? BELT_SQUAT.hook, pivot) } })
}

/** hip belt: an elliptical band round the pelvis (half widths `r` across and front-back), local origin at its centre,
 * the belt in the XZ plane; site `front` where the chain clips on. No parts (never collided). */
export const HIP_BELT = { r: [0.19, 0.14] as [number, number], height: 0.1, thick: 0.012 }

export function hipBelt(o: { id?: string; r?: [number, number] } = {}): ImplementSpec {
  const r = o.r ?? HIP_BELT.r
  return spec(o.id ?? 'hip_belt', 'hip_belt', [], { front: { pos: [0, 0, r[1] + HIP_BELT.thick] }, l: { pos: [r[0], 0, 0] }, r: { pos: [-r[0], 0, 0] } })
}

// ---------- preacher bench ----------

/**
 * Preacher bench. Frame: origin on the floor under the arm pad's top edge, the lifter seated facing +Z with the upper
 * arms on the pad, which slopes down away from them at `padAngle` above horizontal. Sites: `top` (top edge on the
 * surface, axis X: under the armpits), `pad` (surface centre, normal, axis down the pad), `seat` (top centre).
 */
export const PREACHER = {
  pad: { width: 0.56, len: 0.4, thick: 0.07 },
  seat: { width: 0.34, depth: 0.3, thick: 0.07 },
  padAngle: 45,
  padTop: 0.98,
  seatHeight: 0.62,
  /** horizontal distance from the pad's top edge back to the seat centre */
  seatBack: 0.36,
}

export function preacherFrame(padAngle = PREACHER.padAngle) {
  const a = padAngle * DEG
  return { along: [0, -Math.sin(a), Math.cos(a)] as V3, normal: [0, Math.cos(a), Math.sin(a)] as V3, rot: rotX(padAngle) }
}

export function preacherBench(o: { id?: string; padAngle?: number; padTop?: number; seatHeight?: number; seatBack?: number } = {}): ImplementSpec {
  const { pad, seat } = PREACHER
  const { along, normal, rot } = preacherFrame(o.padAngle)
  const top: V3 = [0, o.padTop ?? PREACHER.padTop, 0]
  const sh = o.seatHeight ?? PREACHER.seatHeight
  const sz = -(o.seatBack ?? PREACHER.seatBack)
  const mid = add(top, scale(along, pad.len / 2))
  return spec(o.id ?? 'preacher', 'preacher_bench', [
    box(add(mid, scale(normal, -pad.thick / 2)), [pad.width, pad.thick, pad.len], rot, true),
    box([0, sh - seat.thick / 2, sz], [seat.width, seat.thick, seat.depth], undefined, true),
  ], {
    top: { pos: top, axis: X, normal },
    pad: { pos: mid, normal, axis: along },
    seat: { pos: [0, sh, sz], normal: UP },
  })
}

// ---------- chest-supported T-bar ----------

/**
 * Chest-supported T-bar row. Frame (fixed): origin on the floor under the chest pad's top end, the lifter facing +Z,
 * feet on a raised platform behind, chest on a pad inclined `padAngle` (rising towards +Z), arms hanging to the lever
 * handles under the pad. The lever (tbarLever) pivots low in front and carries a cross bar with neutral grips (close,
 * along Z) and wide pronated grips (ends, along X). Sites: `pad` (surface centre, normal, axis up the pad), `chin` (pad
 * top end on the surface), `platform` (top centre), `pivot` (axis X).
 */
export const TBAR = {
  pad: { width: 0.36, len: 0.6, thick: 0.08, angle: 40, top: [0, 1.24, 0] as V3 },
  platform: { width: 0.62, depth: 0.42, thick: 0.03, at: [0, 0.24, -0.72] as V3 },
  pivot: [0, 0.3, 1.05] as V3,
  /** neutral grip centre-line at the lever's rest pose (frame coords) */
  handle: [0, 0.58, 0.08] as V3,
  grips: { neutral: 0.11, wide: [0.27, 0.4] as [number, number], r: 0.016, len: 0.14, rise: 0.08, ahead: 0.09 },
  beam: 0.03,
}

export function tbarFrame(padAngle = TBAR.pad.angle) {
  const a = padAngle * DEG
  return { along: [0, Math.sin(a), Math.cos(a)] as V3, normal: [0, Math.cos(a), -Math.sin(a)] as V3, rot: rotX(-padAngle) }
}

/**
 * `padLen` / `padWidth`: the chest pad's size (default TBAR.pad), smaller so a lifter's hips, thighs and tucked upper arms
 * clear it
 */
export function tbarStation(o: { id?: string; padAngle?: number; padTop?: V3; platform?: V3; pivot?: V3; padLen?: number; padWidth?: number } = {}): ImplementSpec {
  const { pad, platform: pl } = TBAR
  const { along, normal, rot } = tbarFrame(o.padAngle)
  const top = o.padTop ?? pad.top
  const len = o.padLen ?? pad.len
  const mid = add(top, scale(along, -len / 2))
  const p = o.platform ?? pl.at
  return spec(o.id ?? 'tbar', 'tbar_station', [
    box(add(mid, scale(normal, -pad.thick / 2)), [o.padWidth ?? pad.width, pad.thick, len], rot, true),
    box([p[0], p[1] - pl.thick / 2, p[2]], [pl.width, pl.thick, pl.depth], undefined, true),
  ], {
    pad: { pos: mid, normal, axis: along },
    chin: { pos: top, normal, axis: X },
    platform: { pos: p, normal: UP },
    pivot: { pos: o.pivot ?? TBAR.pivot, axis: X },
  })
}

/** the lever: local origin at the pivot, rest pose with the neutral grips' centre at `handle` (frame coords) */
export function tbarLever(o: { id?: string; pivot?: V3; handle?: V3; plateKg?: number } = {}): ImplementSpec {
  const pivot = o.pivot ?? TBAR.pivot
  const h = sub(o.handle ?? TBAR.handle, pivot)
  const g = TBAR.grips
  const bar: V3 = [0, h[1] + g.rise, h[2] + g.ahead]
  // the beam's collider starts just off the pivot, clear of the axle it turns on (drawn from the pivot all the same)
  const parts: Part[] = [cyl(scale(norm(bar), 0.06), bar, TBAR.beam), cyl([-g.wide[1], bar[1], bar[2]], [g.wide[1], bar[1], bar[2]], 0.02)]
  const sites: Record<string, Site> = {}
  for (const [s, k] of [[1, 'l'], [-1, 'r']] as const) {
    const x = s * g.neutral
    parts.push(cyl([x, h[1], h[2] - g.len / 2], [x, h[1], h[2] + g.len / 2], g.r), cyl([x, h[1], h[2] + g.len / 2], [x, bar[1], bar[2]], 0.012))
    sites[`neutral_${k}`] = { pos: [x, h[1], h[2]], axis: [0, 0, 1] }
    sites[`wide_${k}`] = { pos: [s * (g.wide[0] + g.wide[1]) / 2, bar[1], bar[2]], axis: X }
  }
  return spec(o.id ?? 'tbar_lever', 'tbar_lever', parts, { ...sites, bar: { pos: bar, axis: X } }, 15 + (o.plateKg ?? 40))
}

// ---------- captain's chair ----------

/**
 * Captain's chair (vertical knee raise station). Frame: origin on the floor under the back pad, its surface in the
 * plane z = 0 facing +Z; the lifter hangs on the forearm pads (top at `elbowHeight`), back to the pad, hands on
 * vertical handles at the pads' front ends. Framed whole. Sites: `back`, `forearm_l` / `forearm_r` (top centre,
 * normal up, axis +Z), `handle_l` / `handle_r` (axis +Y), `step_l` / `step_r` (side foot steps, for climbing on).
 */
export const CAPTAIN = {
  back: { width: 0.36, len: 0.62, thick: 0.07, lift: 0.03 },
  forearm: { x: 0.25, width: 0.11, len: 0.36, thick: 0.07, from: 0.02 },
  handle: { r: 0.017, len: 0.13, ahead: 0.04 },
  elbowHeight: 1.32,
  /** side foot steps (top centre |x|, height, z) to climb on, outside the hanging legs */
  step: { x: 0.29, y: 0.36, z: 0.3 },
}

export function captainsChair(o: { id?: string; elbowHeight?: number } = {}): ImplementSpec {
  const { back, forearm: f, handle: h } = CAPTAIN
  const eh = o.elbowHeight ?? CAPTAIN.elbowHeight
  const parts: Part[] = [box([0, eh + back.lift, -back.thick / 2], [back.width, back.len, back.thick], undefined, true)]
  const sites: Record<string, Site> = { back: { pos: [0, eh + back.lift, 0], normal: [0, 0, 1] } }
  const hz = f.from + f.len + h.ahead
  for (const [s, k] of [[1, 'l'], [-1, 'r']] as const) {
    parts.push(box([s * f.x, eh - f.thick / 2, f.from + f.len / 2], [f.width, f.thick, f.len], undefined, true))
    sites[`forearm_${k}`] = { pos: [s * f.x, eh, f.from + f.len / 2], normal: UP, axis: [0, 0, 1] }
  }
  for (const [s, k] of [[1, 'l'], [-1, 'r']] as const) {
    parts.push(cyl([s * f.x, eh - 0.01, hz], [s * f.x, eh + h.len, hz], h.r))
    sites[`handle_${k}`] = { pos: [s * f.x, eh + h.len / 2, hz], axis: UP }
  }
  const st = CAPTAIN.step
  return spec(o.id ?? 'captains_chair', 'captains_chair', parts, { ...sites, step_l: { pos: [st.x, st.y, st.z], normal: UP }, step_r: { pos: [-st.x, st.y, st.z], normal: UP } })
}

// ---------- decline bench with leg hooks ----------

/**
 * Decline bench. Frame: origin on the floor under the pad's high end (the hips), the pad running down towards -Z (the
 * head end) at `decline` deg; the lifter lies supine, head towards -Z. A leg brace in front carries a knee roller (under
 * the backs of the knees) and an ankle roller (over the fronts of the ankles); either may be left out. For the barbell
 * press add the F1 bench uprights (`benchRack` in implements/press-horizontal.ts) at the head end.
 * Sites: `top` (high end of the pad surface, axis X), `back` (pad surface centre, normal, axis down the pad),
 * `knee` / `ankle` (roller axes).
 */
export const DECLINE_BENCH = {
  pad: { width: 0.28, thick: 0.065, len: 1.22 },
  roller: { r: 0.05, half: 0.17 },
  decline: 20,
  top: 0.66,
  knee: { z: 0.36, y: 0.64 },
  ankle: { z: 0.5, y: 0.32 },
}

export function declineFrame(decline = DECLINE_BENCH.decline) {
  const a = decline * DEG
  return { along: [0, -Math.sin(a), -Math.cos(a)] as V3, normal: [0, Math.cos(a), -Math.sin(a)] as V3, rot: rotX(-decline) }
}

export function declineBench(o: { id?: string; decline?: number; top?: number; knee?: { z: number; y: number } | null; ankle?: { z: number; y: number } | null } = {}): ImplementSpec {
  const { pad, roller } = DECLINE_BENCH
  const { along, normal, rot } = declineFrame(o.decline)
  const top: V3 = [0, o.top ?? DECLINE_BENCH.top, 0]
  const mid = add(top, scale(along, pad.len / 2))
  const parts: Part[] = [box(add(mid, scale(normal, -pad.thick / 2)), [pad.width, pad.thick, pad.len], rot, true)]
  const sites: Record<string, Site> = { top: { pos: top, axis: X, normal }, back: { pos: mid, normal, axis: along } }
  for (const k of ['knee', 'ankle'] as const) {
    const r = o[k] === undefined ? DECLINE_BENCH[k] : o[k]
    if (!r) continue
    parts.push(cyl([-roller.half, r.y, r.z], [roller.half, r.y, r.z], roller.r, true))
    sites[k] = { pos: [0, r.y, r.z], axis: X }
  }
  return spec(o.id ?? 'decline_bench', 'decline_bench', parts, sites)
}

// ---------- raised seal-row bench ----------

/**
 * Raised flat bench for the seal row: a long pad high enough that the bar hangs at arm's length under it, legs at the
 * ends only so the bar rises to the pad's underside. Frame: origin on the floor under the pad centre, long axis Z (the
 * head towards +Z). Sites: `top` (surface centre), `head` (head end top edge, axis X), `under` (underside centre).
 */
export const SEAL_BENCH = { width: 0.3, len: 1.3, thick: 0.065, height: { min: 0.75, max: 0.9, default: 0.82 }, board: 0.012 }

export function sealBench(o: { id?: string; height?: number } = {}): ImplementSpec {
  const { width, len, thick, board } = SEAL_BENCH
  const h = Math.min(SEAL_BENCH.height.max, Math.max(SEAL_BENCH.height.min, o.height ?? SEAL_BENCH.height.default))
  return spec(o.id ?? 'seal_bench', 'seal_bench', [box([0, h - thick / 2, 0], [width, thick, len], undefined, true), box([0, h - thick - board / 2, 0], [width - 0.04, board, len - 0.04])], {
    top: { pos: [0, h, 0], normal: UP, axis: [0, 0, 1] },
    head: { pos: [0, h, len / 2], axis: X, normal: UP },
    under: { pos: [0, h - thick - board, 0], normal: [0, -1, 0] },
  })
}

// ---------- reverse hyper ----------

/**
 * Reverse hyperextension. Frame (fixed): origin on the floor under the pad's rear (hip) edge, the pad running forward
 * (+Z, the head end) at `padTop`; the lifter lies prone with the hips at the edge and the legs hanging, hands on
 * handles beside the pad's front end. The pendulum (hyperLever) pivots under the pad and carries a padded roller behind
 * the ankles, the strap looping round them; turning it by positive deg swings the legs back and up.
 * Sites: `pad` (surface centre), `edge` (rear top edge, axis X), `handle_l` / `handle_r` (axis +Z), `pivot` (axis X).
 */
export const REVERSE_HYPER = {
  pad: { width: 0.42, len: 0.62, thick: 0.07 },
  padTop: 1.05,
  handle: { x: 0.25, r: 0.017, from: 0.5, to: 0.68, drop: 0.08 },
  pivot: [0, 0.9, 0.15] as V3,
  /** roller axle at the lever's rest pose (frame coords): behind the ankles of the hanging legs */
  roller: [0, 0.28, -0.14] as V3,
  lever: { x: 0.24, r: 0.02, rollerR: 0.04, rollerHalf: 0.2 },
}

export function reverseHyper(o: { id?: string; padTop?: number; pivot?: V3 } = {}): ImplementSpec {
  const { pad, handle: h } = REVERSE_HYPER
  const top = o.padTop ?? REVERSE_HYPER.padTop
  const parts: Part[] = [box([0, top - pad.thick / 2, pad.len / 2], [pad.width, pad.thick, pad.len], undefined, true)]
  const sites: Record<string, Site> = { pad: { pos: [0, top, pad.len / 2], normal: UP, axis: [0, 0, 1] }, edge: { pos: [0, top, 0], axis: X, normal: UP } }
  for (const [s, k] of [[1, 'l'], [-1, 'r']] as const) {
    parts.push(cyl([s * h.x, top - h.drop, h.from], [s * h.x, top - h.drop, h.to], h.r))
    sites[`handle_${k}`] = { pos: [s * h.x, top - h.drop, (h.from + h.to) / 2], axis: [0, 0, 1] }
  }
  return spec(o.id ?? 'reverse_hyper', 'reverse_hyper', parts, { ...sites, pivot: { pos: o.pivot ?? REVERSE_HYPER.pivot, axis: X } })
}

/** the pendulum: local origin at the pivot, side arms outside the legs down to a padded roller at `roller` (frame
 * coords at rest). Sites: `roller` (axle, axis X), `strap` (where the ankle strap closes, just ahead of the roller). */
export function hyperLever(o: { id?: string; pivot?: V3; roller?: V3 } = {}): ImplementSpec {
  const { lever: L } = REVERSE_HYPER
  const pivot = o.pivot ?? REVERSE_HYPER.pivot
  const r = sub(o.roller ?? REVERSE_HYPER.roller, pivot)
  const parts: Part[] = [cyl([-L.rollerHalf, r[1], r[2]], [L.rollerHalf, r[1], r[2]], L.rollerR, true)]
  for (const s of [1, -1]) parts.push(cyl([s * L.x, 0, 0], [s * L.x, r[1], r[2]], L.r))
  const strap = add(r, [0, 0, L.rollerR + 0.05])
  return spec(o.id ?? 'hyper_lever', 'hyper_lever', parts, { roller: { pos: r, axis: X }, strap: { pos: strap } })
}

// ---------- incline machine chest press (122) ----------

/**
 * Lever pivot for an incline press on the seated chest press (implements/press-horizontal.ts chestPressFrame /
 * chestPressArms, drawn by the F1 props unchanged). The handles travel on an arc round the pivot; to press up and
 * forward at `incline` deg above horizontal at mid-stroke the pivot sits `reach` m from the mid-stroke handle point,
 * below and in front of it. The levers' vertical handles then stay square to the press line (they lean back by the
 * incline). Returns the pivot and the lever swing (deg about X, as press-machine.ts armPose) at the start and the end
 * of a `stroke` m press.
 */
export function inclinePressLever(o: { mid: V3; incline: number; reach: number; stroke: number }): { pivot: V3; swing: [number, number] } {
  const a = o.incline * DEG
  const pivot: V3 = [o.mid[0], o.mid[1] - o.reach * Math.cos(a), o.mid[2] + o.reach * Math.sin(a)]
  const half = o.stroke / 2 / o.reach / DEG
  return { pivot, swing: [-o.incline - half, -o.incline + half] }
}

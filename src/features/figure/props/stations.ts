import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Baked } from '../../../motion/bake.ts'
import type { ImplementSpec, Part } from '../../../motion/implements.ts'
import {
  BELT_SQUAT,
  CAPTAIN,
  CARRIAGE,
  DECLINE_BENCH,
  GHD,
  HACK,
  HIP_BELT,
  PREACHER,
  REVERSE_HYPER,
  SEAL_BENCH,
  TBAR,
} from '../../../motion/implements/stations.ts'
import { finish, Kit, type Piece, type PropBuild } from './kit.ts'
import { firstPose, fixedLayout, poseMatrix4, type LayoutSource, type MachineLayout, type Poses } from './layout.ts'
import { foot, holeRow } from './parts.ts'
import type { GripSocket, SurfaceSocket } from './sockets.ts'

// Fixed machine stations (implements/stations.ts) drawn round their contact parts in the approved style: light
// powder-coated frames, black pads on dark backing boards, rubber treads and feet, steel axles and rails. Each builder
// takes the implement spec and returns the pieces in that implement's frame with its sockets; moving parts (hack
// sled, pendulum arm, levers) draw in their own frame and the layouts pose them every frame. Layout pieces are also the
// QA penetration gate's collision primitives (collision.ts); straps, chains and the hip belt are drawn only.

type Box = Extract<Part, { shape: 'box' }>
type Cyl = Extract<Part, { shape: 'cylinder' }>

const V = (v: readonly number[]) => new Vector3(v[0], v[1], v[2])
const Q = (q?: readonly number[]) => (q ? new Quaternion(q[0], q[1], q[2], q[3]) : new Quaternion())
const XA = new Vector3(1, 0, 0)
const YA = new Vector3(0, 1, 0)
const ZA = new Vector3(0, 0, 1)
const boxes = (s: ImplementSpec) => s.parts.filter((p): p is Box => p.shape === 'box')
const cyls = (s: ImplementSpec) => s.parts.filter((p): p is Cyl => p.shape === 'cylinder')

export type StationSockets = {
  /** grip handles: centre under the hand, axis little finger to index */
  grips: Record<string, GripSocket>
  /** surfaces the body rests or stands on */
  surfaces: Record<string, SurfaceSocket>
  /** rollers, pivots and rails: a point on the axis and the axis */
  axes: Record<string, GripSocket>
}

/** sockets from an implement's sites: `grips` by name, sites with a normal as surfaces, the rest as axes */
function socketsOf(spec: ImplementSpec, grips: string[]): StationSockets {
  const out: StationSockets = { grips: {}, surfaces: {}, axes: {} }
  for (const [k, s] of Object.entries(spec.sites)) {
    const position = V(s.pos)
    if (grips.includes(k)) out.grips[k] = { position, axis: V(s.axis!).normalize() }
    else if (s.normal) out.surfaces[k] = { position, normal: V(s.normal).normalize(), ...(s.axis ? { along: V(s.axis).normalize() } : {}) }
    else out.axes[k] = { position, axis: V(s.axis ?? [1, 0, 0]).normalize() }
  }
  return out
}

/** a pad part drawn as a black pad with a dark backing board on the face opposite `out` */
function pad(kit: Kit, p: Box, out: Vector3, radius = 0.024) {
  const rot = Q(p.rot)
  kit.box(p.center, p.size, 'pad', rot, radius)
  const thin = p.size.indexOf(Math.min(...p.size))
  const size = p.size.map((s, k) => (k === thin ? 0.012 : Math.max(0.02, s - 0.04))) as [number, number, number]
  kit.box(V(p.center).addScaledVector(out, -(p.size[thin] / 2 + 0.006)), size, 'frameDark', rot, 0.004)
  return V(p.center).addScaledVector(out, -(p.size[thin] / 2 + 0.012))
}

/** a support plate (foot plate, deck) whose `out` face is a rubber tread over a light frame plate */
function treadPlate(kit: Kit, p: Box, out: Vector3) {
  const rot = Q(p.rot)
  const thin = p.size.indexOf(Math.min(...p.size))
  const t = 0.01
  const body = p.size.map((s, k) => (k === thin ? s - t : s)) as [number, number, number]
  const tread = p.size.map((s, k) => (k === thin ? t : s - 0.004)) as [number, number, number]
  kit.box(V(p.center).addScaledVector(out, -t / 2), body, 'frame', rot, 0.006)
  kit.box(V(p.center).addScaledVector(out, (p.size[thin] - t) / 2), tread, 'rubber', rot, 0.003)
}

/** foam roller on a steel axle that sticks out `stub` m past both ends */
function roller(kit: Kit, c: Cyl, stub = 0.03) {
  kit.rod(c.a, c.b, c.r, 'pad', 32)
  const a = V(c.a), b = V(c.b), d = b.clone().sub(a).normalize()
  kit.rod(a.clone().addScaledVector(d, -stub), b.clone().addScaledVector(d, stub), 0.011, 'steel', 16)
  for (const e of [a.clone().addScaledVector(d, -0.004), b]) kit.rod(e, e.clone().addScaledVector(d, 0.004), c.r * 0.55, 'frameDark', 24)
}

/** rubber grip with an end knob on a handle part */
function grip(kit: Kit, c: Cyl) {
  kit.rod(c.a, c.b, c.r, 'rubber', 24)
  kit.sphere(c.b, c.r + 0.003, 'rubber')
}

/** floor rail along Z at x with rubber feet under both ends */
function rail(kit: Kit, x: number, z0: number, z1: number) {
  kit.tube([x, 0.025, z0], [x, 0.025, z1], 0.07, 0.05, 'frame', { side: XA, cap: 'both' })
  foot(kit, [x, 0, z0 + 0.04])
  foot(kit, [x, 0, z1 - 0.04])
}

/** floor cross member along X with rubber feet under both ends */
function stabiliser(kit: Kit, z: number, half: number) {
  kit.tube([-half, 0.025, z], [half, 0.025, z], 0.07, 0.05, 'frame', { side: ZA, cap: 'both' })
  for (const s of [-1, 1]) foot(kit, [s * (half - 0.03), 0, z])
}

/** plates on a horn from `a` towards `b` (steel), a collar first */
function horn(kit: Kit, a: Vector3, b: Vector3, plates: number, R = 0.225, w = 0.05) {
  const d = b.clone().sub(a).normalize()
  kit.rod(a, b, 0.025, 'steel', 24)
  kit.rod(a, a.clone().addScaledVector(d, 0.012), 0.045, 'frameDark', 28)
  for (let i = 0; i < plates; i++) kit.plate(a.clone().addScaledVector(d, 0.02 + i * (w + 0.003)), d, R, w)
}

// ---------- GHD ----------

export function buildGhd(spec: ImplementSpec): PropBuild<StationSockets> {
  const kit = new Kit()
  const [nose, rear, plate, hi, lo] = spec.parts as [Cyl, Box, Box, Cyl, Cyl]
  const { pad: P, roller: R } = GHD
  const top = rear.center[1] + rear.size[1] / 2
  const noseZ = nose.a[2]
  const padZ = rear.center[2]

  // thigh pad: round nose and flat rear section on a saddle plate
  kit.rod(nose.a, nose.b, nose.r, 'pad', 40)
  kit.box(rear.center, rear.size, 'pad', undefined, 0.04)
  const under = top - P.thick - 0.012
  kit.box([0, under, padZ + 0.04], [P.width - 0.08, 0.024, P.depth + 0.12], 'frameDark', undefined, 0.005)
  for (const s of [-1, 1]) kit.rod([s * (P.width / 2), nose.a[1], noseZ], [s * (P.width / 2 + 0.01), nose.a[1], noseZ], nose.r * 0.55, 'frameDark', 28)

  // foot plate facing +Z with its tread, ankle rollers on side struts outboard of the legs
  treadPlate(kit, plate, ZA)
  roller(kit, hi)
  roller(kit, lo)
  const back = plate.center[2] - plate.size[2] / 2
  const sx = R.half + 0.035
  for (const s of [-1, 1]) {
    for (const r of [hi, lo]) kit.tube([s * sx, r.a[1], back - 0.01], [s * sx, r.a[1], r.a[2]], 0.035, 0.03, 'frame', { side: YA, cap: 'b' })
    kit.tube([s * sx, lo.a[1] - 0.05, back - 0.02], [s * sx, hi.a[1] + 0.03, back - 0.02], 0.04, 0.035, 'frame', { side: ZA, cap: 'both' })
  }
  const plateLow = plate.center[1] - plate.size[1] / 2
  kit.box([0, plate.center[1], back - 0.012], [plate.size[0] - 0.02, plate.size[1] - 0.02, 0.016], 'frameDark', undefined, 0.004)

  // frame: base beam, foot-plate post, pad post on a slide with adjustment holes
  const base = 0.04
  const z0 = -0.38, z1 = noseZ + 0.32
  kit.tube([0, base, z0], [0, base, z1], 0.08, 0.06, 'frame', { side: XA, cap: 'both' })
  for (const z of [z0 + 0.05, z1 - 0.05]) stabiliser(kit, z, 0.34)
  const postZ = back - 0.05
  kit.tube([0, base + 0.03, postZ], [0, plateLow + 0.05, postZ], 0.07, 0.07, 'frame', { cap: 'b' })
  kit.tube([0, plateLow + 0.03, postZ], [0, plateLow + 0.03, back - 0.01], 0.05, 0.05, 'frame', { side: XA })
  const slideY = 0.52
  kit.tube([0, slideY, postZ - 0.02], [0, slideY, padZ + 0.1], 0.07, 0.06, 'frame', { side: XA, cap: 'both' })
  for (let z = postZ + 0.12; z < padZ - 0.06; z += 0.06) kit.hole([0, slideY + 0.03, z], [0, 1, 0], 0.008)
  kit.tube([0, base + 0.03, padZ], [0, under - 0.012, padZ], 0.08, 0.08, 'frame')
  kit.tube([0, base + 0.03, padZ - 0.3], [0, slideY - 0.03, padZ - 0.05], 0.05, 0.05, 'frame', { side: XA })
  kit.knob([0.04, slideY, padZ - 0.14], [1, 0, 0], 0.016)
  return finish(kit, socketsOf(spec, []))
}

// ---------- shoulder carriage (hack sled, pendulum arm) ----------

/** the carriage drawn in its own frame (CARRIAGE): pads, boards, handles on side brackets, a carriage plate behind */
function drawCarriage(kit: Kit, parts: Part[]) {
  const [back, shL, shR, hL, hR] = parts as [Box, Box, Box, Cyl, Cyl]
  const { back: B } = CARRIAGE
  pad(kit, back, YA)
  for (const s of [shL, shR]) kit.box(s.center, s.size, 'pad', undefined, 0.035)
  const plateY = -B.thick - 0.03
  // the carriage plate behind the pad, as long as the pad (a template may shorten it)
  const [from, to] = [back.center[2] - back.size[2] / 2, back.center[2] + back.size[2] / 2]
  kit.box([0, plateY, (from + to) / 2], [B.width + 0.06, 0.03, to - from + 0.04], 'frame', undefined, 0.008)
  for (const s of [shL, shR]) {
    const x = s.center[0]
    kit.tube([x, plateY, s.center[2]], [x, s.center[1] - s.size[1] / 2 + 0.01, s.center[2]], 0.05, 0.05, 'frame')
  }
  for (const h of [hL, hR]) {
    const x = h.a[0], sx = Math.sign(x)
    // brackets at the handle's height on the pad (CARRIAGE.handle.z unless a template moved the handles); a handle
    // moved past the pad's lower end hangs on a bracket angled down from it
    const z = h.a[2], from = Math.min(z, back.center[2] + back.size[2] / 2 - 0.03)
    kit.tube([sx * (B.width / 2 + 0.02), plateY, from], [x, plateY, z], 0.04, 0.04, 'frame', { side: ZA, cap: 'b' })
    kit.rod([x, plateY, z], [x, h.a[1], z], 0.016, 'steel', 20)
    grip(kit, h)
  }
}

// ---------- hack squat ----------

/** the fixed frame: rails, posts, base and the foot plate (frame of hackSquat) */
export function buildHackFrame(spec: ImplementSpec): PropBuild<StationSockets> {
  const kit = new Kit()
  const [plate] = boxes(spec)
  const { rail: Rl, travel } = HACK
  const bottom = V(spec.sites.rail.pos), up = V(spec.sites.rail.axis!).normalize()
  const n = new Vector3(0, -up.z, up.y)
  const line = (t: number, x: number, drop = 0) => bottom.clone().addScaledVector(n, -Rl.drop - drop).addScaledVector(up, t).setX(x)
  const t0 = -Rl.below, t1 = travel + Rl.above
  const lowEnd = line(t0, 0, 0.065), highEnd = line(t1, 0, 0.065)
  for (const s of [-1, 1]) {
    const x = s * Rl.x
    kit.rod(line(t0, x), line(t1, x), 0.02, 'steel')
    kit.tube(line(t0 - 0.04, x, 0.065), line(t1 + 0.04, x, 0.065), 0.07, 0.09, 'frame', { side: XA, cap: 'both' })
    // rubber stop at the bottom of the travel
    kit.rod(line(-0.04, x), line(-0.02, x), 0.034, 'rubber', 24)
    kit.tube([x, 0.05, lowEnd.z], [x, lowEnd.y - 0.04, lowEnd.z], 0.07, 0.07, 'frame')
    kit.tube([x, 0.05, highEnd.z], [x, highEnd.y - 0.04, highEnd.z], 0.07, 0.07, 'frame', { cap: 'b' })
  }
  kit.tube([-Rl.x + 0.035, highEnd.y - 0.07, highEnd.z], [Rl.x - 0.035, highEnd.y - 0.07, highEnd.z], 0.07, 0.07, 'frame', { side: ZA })
  // base: side rails from behind the rear posts to in front of the foot plate, cross members
  const front = plate.center[2] + plate.size[2] / 2 + 0.12
  const rear = highEnd.z - 0.16
  const bx = Rl.x + 0.1
  for (const s of [-1, 1]) rail(kit, s * bx, rear, front)
  for (const z of [rear + 0.06, lowEnd.z, highEnd.z, front - 0.06]) kit.tube([-bx + 0.035, 0.025, z], [bx - 0.035, 0.025, z], 0.07, 0.05, 'frame', { side: ZA })
  for (const s of [-1, 1]) kit.tube([s * Rl.x, 0.03, lowEnd.z], [s * bx, 0.03, lowEnd.z], 0.07, 0.05, 'frame', { side: ZA })
  // foot plate on a wedge frame
  const n2 = new Vector3(0, 1, 0).applyQuaternion(Q(plate.rot))
  treadPlate(kit, plate, n2)
  const underC = V(plate.center).addScaledVector(n2, -plate.size[1] / 2 - 0.03)
  kit.box(underC, [plate.size[0] - 0.08, 0.04, plate.size[2] - 0.06], 'frame', Q(plate.rot), 0.008)
  for (const s of [-1, 1]) for (const dz of [-0.2, 0.2]) {
    const top = underC.clone().add(new Vector3(s * 0.3, 0, dz).applyQuaternion(Q(plate.rot)))
    kit.tube([top.x, 0.05, top.z], [top.x, top.y - 0.015, top.z], 0.05, 0.05, 'frame')
  }
  return finish(kit, socketsOf(spec, []))
}

/** the sled in the carriage frame: the carriage plus bearing blocks on the rails, frame tubes and two loaded horns */
export function buildHackSled(spec: ImplementSpec): PropBuild<StationSockets> {
  const kit = new Kit()
  drawCarriage(kit, spec.parts)
  const { rail: Rl } = HACK
  const { back: B } = CARRIAGE
  const plateY = -B.thick - 0.03
  for (const s of [-1, 1]) {
    const x = s * Rl.x
    for (const z of [B.from + 0.12, B.to - 0.12]) {
      kit.box([x, -Rl.drop, z], [0.075, 0.075, 0.16], 'frameDark', undefined, 0.01)
      kit.tube([s * (B.width / 2 - 0.02), plateY, z], [x, -Rl.drop + 0.04, z], 0.05, 0.05, 'frame', { side: ZA })
    }
    kit.tube([x, -Rl.drop + 0.045, B.from + 0.04], [x, -Rl.drop + 0.045, B.to - 0.04], 0.05, 0.04, 'frame', { side: XA })
    const hz = B.to - 0.2
    horn(kit, new Vector3(s * (Rl.x + 0.05), -Rl.drop + 0.03, hz), new Vector3(s * (Rl.x + 0.36), -Rl.drop + 0.03, hz), 1)
  }
  return finish(kit, socketsOf(spec, ['handle_l', 'handle_r']))
}

// ---------- pendulum squat ----------

/** the fixed frame: rear tower with the pivot bearings, platform, base */
export function buildPendulumFrame(spec: ImplementSpec): PropBuild<StationSockets> {
  const kit = new Kit()
  const [plat] = boxes(spec)
  const pivot = V(spec.sites.pivot.pos)
  const tx = 0.34
  const n = new Vector3(0, 1, 0).applyQuaternion(Q(plat.rot))
  treadPlate(kit, plat, n)
  const underC = V(plat.center).addScaledVector(n, -plat.size[1] / 2 - 0.03)
  kit.box(underC, [plat.size[0] - 0.08, 0.04, plat.size[2] - 0.06], 'frame', Q(plat.rot), 0.008)
  for (const s of [-1, 1]) for (const dz of [-0.2, 0.2]) {
    const top = underC.clone().add(new Vector3(s * 0.3, 0, dz).applyQuaternion(Q(plat.rot)))
    kit.tube([top.x, 0.05, top.z], [top.x, top.y - 0.015, top.z], 0.05, 0.05, 'frame')
  }
  // tower: two posts outside the arm, bearings on the pivot axis, a top cross member and rear braces
  for (const s of [-1, 1]) {
    const x = s * tx
    kit.tube([x, 0.05, pivot.z], [x, pivot.y + 0.12, pivot.z], 0.08, 0.08, 'frame', { cap: 'b' })
    kit.rod([s * (tx - 0.035), pivot.y, pivot.z], [s * (tx - 0.045), pivot.y, pivot.z], 0.045, 'frameDark', 28)
    kit.tube([x, 0.05, pivot.z - 0.55], [x, pivot.y - 0.35, pivot.z - 0.03], 0.06, 0.06, 'frame')
    rail(kit, x, pivot.z - 0.62, V(plat.center).z + plat.size[2] / 2 + 0.12)
  }
  kit.tube([-tx - 0.04, pivot.y + 0.16, pivot.z], [tx + 0.04, pivot.y + 0.16, pivot.z], 0.08, 0.08, 'frame', { side: ZA, cap: 'both' })
  kit.rod([-tx + 0.04, pivot.y, pivot.z], [tx - 0.04, pivot.y, pivot.z], 0.018, 'steel', 20)
  for (const z of [pivot.z - 0.56, pivot.z, V(plat.center).z]) kit.tube([-tx + 0.035, 0.025, z], [tx - 0.035, 0.025, z], 0.07, 0.05, 'frame', { side: ZA })
  return finish(kit, socketsOf(spec, []))
}

/** the swing arm in its frame (origin on the pivot): side beams from the hubs to the carriage, carriage, load horn */
export function buildPendulumArm(spec: ImplementSpec): PropBuild<StationSockets> {
  const kit = new Kit()
  const car = spec.sites.carriage
  const t = V(car.pos), z = V(car.axis!).normalize(), y = V(car.normal!).normalize()
  const x = new Vector3().crossVectors(y, z)
  const m = new Matrix4().makeBasis(x, y, z).setPosition(t)
  const inv = m.clone().invert()
  const local = new Kit()
  // carriage parts back in the carriage frame
  const parts = spec.parts.map((p): Part => {
    if (p.shape === 'cylinder') return { ...p, a: V(p.a).applyMatrix4(inv).toArray() as [number, number, number], b: V(p.b).applyMatrix4(inv).toArray() as [number, number, number] }
    const q = new Quaternion().setFromRotationMatrix(inv).multiply(Q(p.rot))
    return { ...p, center: V(p.center).applyMatrix4(inv).toArray() as [number, number, number], rot: [q.x, q.y, q.z, q.w] }
  })
  drawCarriage(local, parts)
  kit.merge(local, m)
  // beams from the hubs down to the carriage plate's upper corners
  const { back: B } = CARRIAGE
  const plateY = -B.thick - 0.045
  const bx = 0.25
  for (const s of [-1, 1]) {
    const hub = new Vector3(s * bx, 0, 0)
    kit.rod(hub.clone().setX(s * (bx - 0.04)), hub.clone().setX(s * (bx + 0.04)), 0.055, 'frameDark', 28)
    for (const dz of [B.from + 0.08, B.to - 0.1]) {
      const end = new Vector3(s * bx, plateY, dz).applyMatrix4(m)
      kit.tube(hub, end, 0.06, 0.05, 'frame', { side: XA })
    }
  }
  kit.tube([-bx, 0, 0], [bx, 0, 0], 0.06, 0.06, 'frame', { side: YA })
  // counter-lever behind the pivot with a loaded horn
  const away = t.clone().negate().setX(0).normalize()
  const hornAt = away.clone().multiplyScalar(0.38)
  kit.tube([0, 0, 0], hornAt, 0.06, 0.06, 'frame', { side: XA, cap: 'b' })
  for (const s of [-1, 1]) horn(kit, hornAt.clone().setX(s * 0.04), hornAt.clone().setX(s * 0.3), 1)
  return finish(kit, socketsOf(spec, ['handle_l', 'handle_r']))
}

// ---------- belt squat ----------

export function buildBeltSquat(spec: ImplementSpec): PropBuild<StationSockets> {
  const kit = new Kit()
  const [deckL, deckR] = boxes(spec)
  const [bar] = cyls(spec)
  const { deck, bar: Bb } = BELT_SQUAT
  const pivot = V(spec.sites.pivot.pos)
  // deck halves: rubber tread on a light box, the slot open between them for the lever
  for (const d of [deckL, deckR]) {
    treadPlate(kit, d, YA)
    const h = d.center[1] - d.size[1] / 2
    kit.box([d.center[0], (h + 0.05) / 2, d.center[2]], [d.size[0], h - 0.05, d.size[2] - 0.04], 'frame', undefined, 0.01)
  }
  // base: side rails out to the pivot, cross members front and back
  const bx = deck.half + 0.06
  const front = pivot.z + 0.16, rear = -deck.depth / 2 - 0.08
  for (const s of [-1, 1]) rail(kit, s * bx, rear, front)
  for (const z of [rear + 0.05, deck.depth / 2 + 0.05, front - 0.05]) kit.tube([-bx + 0.035, 0.025, z], [bx - 0.035, 0.025, z], 0.07, 0.05, 'frame', { side: ZA })
  // pivot cheeks either side of the lever, axle
  for (const s of [-1, 1]) kit.box([s * 0.05, (pivot.y + 0.08) / 2, pivot.z], [0.016, pivot.y + 0.08, 0.14], 'frame', undefined, 0.004)
  kit.rod([-0.07, pivot.y, pivot.z], [0.07, pivot.y, pivot.z], 0.016, 'steel', 16)
  // grab bar on two posts, at the bar's height and distance (beltSquat's `bar` option)
  const px = Bb.half + 0.04
  const [by, bz] = [bar.a[1], bar.a[2]]
  kit.knurl(bar.a, bar.b, bar.r)
  for (const s of [-1, 1]) {
    kit.tube([s * px, 0.05, bz], [s * px, by + 0.04, bz], 0.06, 0.06, 'frame', { cap: 'b' })
    kit.rod([s * Bb.half, by, bz], [s * (px - 0.03), by, bz], 0.022, 'frameDark', 20)
    kit.tube([s * px, 0.03, bz], [s * bx, 0.03, bz], 0.06, 0.05, 'frame', { side: ZA })
  }
  return finish(kit, socketsOf(spec, ['handle_l', 'handle_r']))
}

/** the lever in its frame (origin on the pivot): beam, hub, hook ring, a loaded horn in front of the deck */
export function buildBeltLever(spec: ImplementSpec): PropBuild<StationSockets> {
  const kit = new Kit()
  const hook = V(spec.sites.hook.pos)
  const dir = hook.clone().normalize()
  kit.rod([-0.04, 0, 0], [0.04, 0, 0], 0.04, 'frameDark', 28)
  kit.tube([0, 0, 0], hook.clone().addScaledVector(dir, 0.03), 0.055, 0.06, 'frame', { side: XA, cap: 'b' })
  kit.torus(hook.clone().add(new Vector3(0, 0.035, 0)), 0.02, 0.006, [1, 0, 0], 'steel')
  const at = dir.clone().multiplyScalar(0.34)
  for (const s of [-1, 1]) horn(kit, at.clone().setX(s * 0.03), at.clone().setX(s * 0.26), 1, 0.16, 0.035)
  return finish(kit, socketsOf(spec, []))
}

/** the hip belt (drawn only): a flat black band round the pelvis with a ring at the front */
export function drawHipBelt(kit: Kit, spec: ImplementSpec, m: Matrix4) {
  const rx = spec.sites.l.pos[0], rz = spec.sites.front.pos[2] - HIP_BELT.thick
  const tube = 0.1
  const local = new Matrix4().makeRotationX(-Math.PI / 2).scale(new Vector3(rx, rz, HIP_BELT.height / (2 * tube)))
  kit.add(`torus:1:${tube}:${+(Math.PI * 2).toFixed(4)}`, 'pad', m.clone().multiply(local))
  kit.torus(V(spec.sites.front.pos).applyMatrix4(m), 0.022, 0.005, new Vector3(1, 0, 0).transformDirection(m), 'steel')
}

/** chain from the belt's front ring down to the lever hook (drawn only) */
export function drawChain(kit: Kit, from: Vector3, to: Vector3) {
  const d = to.clone().sub(from)
  const L = d.length()
  const n = Math.max(2, Math.round(L / 0.05))
  const side = Math.abs(d.clone().normalize().y) > 0.9 ? XA : YA
  for (let i = 0; i < n; i++) {
    const c = from.clone().addScaledVector(d, (i + 0.5) / n)
    const normal = i % 2 ? side : new Vector3().crossVectors(d, side).normalize()
    kit.torus(c, 0.014, 0.004, normal, 'steelDark')
  }
}

// ---------- preacher bench ----------

export function buildPreacher(spec: ImplementSpec): PropBuild<StationSockets> {
  const kit = new Kit()
  const [armPad, seat] = boxes(spec)
  const n = V(spec.sites.pad.normal!)
  const along = V(spec.sites.pad.axis!)
  const board = pad(kit, armPad, n, 0.03)
  pad(kit, seat, YA)
  const { seat: S } = PREACHER
  // pad column from the base to the board's centre, a brace to the lower edge
  const colBase = new Vector3(0, 0.05, board.z - 0.04)
  kit.tube(colBase, board.clone().addScaledVector(n, -0.02), 0.07, 0.07, 'frame')
  kit.tube(colBase.clone().setZ(colBase.z + 0.22), board.clone().addScaledVector(along, 0.14).addScaledVector(n, -0.02), 0.05, 0.05, 'frame', { side: XA })
  // seat post with an adjustment sleeve and pop pin, base spine and stabilisers
  const sz = seat.center[2], sb = seat.center[1] - S.thick / 2 - 0.012
  kit.tube([0, 0.05, sz], [0, sb, sz], 0.06, 0.06, 'frame')
  kit.tube([0, 0.05, sz], [0, sb * 0.6, sz], 0.075, 0.075, 'frame', { cap: 'b' })
  holeRow(kit, 0, sz + 0.031, [0, 0, 1], sb * 0.62, sb - 0.04, 0.045, 0.007)
  kit.knob([0, sb * 0.52, sz + 0.038], [0, 0, 1], 0.014)
  const z0 = sz - S.depth / 2 - 0.06, z1 = board.z + 0.34
  kit.tube([0, 0.03, z0], [0, 0.03, z1], 0.08, 0.06, 'frame', { side: XA, cap: 'both' })
  for (const z of [z0 + 0.04, z1 - 0.04]) stabiliser(kit, z, 0.3)
  // foot bar in front of the seat post
  kit.rod([-0.18, 0.2, sz + 0.2], [0.18, 0.2, sz + 0.2], 0.02, 'rubber', 20)
  kit.tube([0, 0.05, sz + 0.2], [0, 0.18, sz + 0.2], 0.04, 0.04, 'frame')
  return finish(kit, socketsOf(spec, []))
}

// ---------- chest-supported T-bar ----------

export function buildTbarStation(spec: ImplementSpec): PropBuild<StationSockets> {
  const kit = new Kit()
  const [chest, plat] = boxes(spec)
  const n = V(spec.sites.pad.normal!)
  const along = V(spec.sites.pad.axis!)
  const pivot = V(spec.sites.pivot.pos)
  const board = pad(kit, chest, n, 0.03)
  treadPlate(kit, plat, YA)
  const pz = plat.center[2], ph = plat.center[1] - plat.size[1] / 2
  for (const s of [-1, 1]) for (const dz of [-0.15, 0.15]) kit.tube([s * 0.24, 0.05, pz + dz], [s * 0.24, ph - 0.005, pz + dz], 0.05, 0.05, 'frame')
  kit.box([0, ph - 0.02, pz], [plat.size[0] - 0.06, 0.04, plat.size[2] - 0.04], 'frame', undefined, 0.008)
  // pad post and brace, base spine at the side so the lever swings clear, pivot cheeks. A shortened pad (tbarStation
  // padLen) keeps its mount where the full-length pad's centre is, below the lifter's hanging arms
  const post = board.clone().addScaledVector(n, -0.03).addScaledVector(along, (chest.size[2] - TBAR.pad.len) / 2)
  const px = 0.28
  kit.tube([0, post.y, post.z], [px, post.y - 0.08, post.z], 0.06, 0.05, 'frame', { side: ZA })
  kit.tube([px, 0.05, post.z], [px, post.y - 0.06, post.z], 0.07, 0.07, 'frame', { cap: 'b' })
  kit.tube([px, 0.05, post.z - 0.32], [px, post.y - 0.25, post.z - 0.02], 0.05, 0.05, 'frame')
  kit.tube(board.clone().addScaledVector(along, -0.22), board.clone().addScaledVector(along, 0.22), 0.05, 0.04, 'frame', { side: XA })
  for (const s of [-1, 1]) rail(kit, s * px, pz - 0.28, pivot.z + 0.16)
  for (const z of [pz - 0.22, post.z, pivot.z]) kit.tube([-px + 0.035, 0.025, z], [px - 0.035, 0.025, z], 0.07, 0.05, 'frame', { side: ZA })
  for (const s of [-1, 1]) kit.box([s * 0.055, (pivot.y + 0.08) / 2, pivot.z], [0.016, pivot.y + 0.08, 0.14], 'frame', undefined, 0.004)
  kit.rod([-0.075, pivot.y, pivot.z], [0.075, pivot.y, pivot.z], 0.016, 'steel', 16)
  return finish(kit, socketsOf(spec, []))
}

/** the lever in its frame (origin on the pivot): beam, cross bar with wide and neutral grips, plates on an upright horn */
export function buildTbarLever(spec: ImplementSpec): PropBuild<StationSockets> {
  const kit = new Kit()
  const [beam, cross, nL, sL, nR, sR] = spec.parts as Cyl[]
  const { grips: G } = TBAR
  const end = V(beam.b), dir = end.clone().normalize()
  kit.rod([-0.045, 0, 0], [0.045, 0, 0], 0.04, 'frameDark', 28)
  kit.tube([0, 0, 0], end, 0.06, 0.05, 'frame', { side: XA })
  kit.tube(V(cross.a).setX(-G.wide[0]), V(cross.b).setX(G.wide[0]), 0.04, 0.04, 'frame', { side: YA })
  for (const s of [-1, 1]) {
    kit.knurl(V(cross.a).setX(s * G.wide[0]), V(cross.a).setX(s * G.wide[1]), G.r)
    kit.rod(V(cross.a).setX(s * G.wide[1]), V(cross.a).setX(s * (G.wide[1] + 0.012)), G.r + 0.004, 'rubber', 20)
  }
  for (const [g, st] of [[nL, sL], [nR, sR]]) {
    kit.knurl(g.a, g.b, g.r)
    kit.rod(st.a, st.b, st.r, 'steel', 16)
    kit.rod(g.a, V(g.a).add(new Vector3(0, 0, -0.012)), g.r + 0.004, 'rubber', 20)
  }
  // upright horn 40 % along the beam, square to it, with the plates lying on a collar
  const at = dir.clone().multiplyScalar(0.4 * V(beam.b).length())
  const upright = new Vector3().crossVectors(XA, dir).normalize()
  if (upright.y < 0) upright.negate()
  const plates = Math.round((spec.mass - 15) / 20)
  horn(kit, at.clone().addScaledVector(upright, 0.03), at.clone().addScaledVector(upright, 0.06 + plates * 0.053 + 0.06), plates)
  return finish(kit, socketsOf(spec, ['neutral_l', 'neutral_r', 'wide_l', 'wide_r']))
}

// ---------- captain's chair ----------

export function buildCaptainsChair(spec: ImplementSpec): PropBuild<StationSockets> {
  const kit = new Kit()
  const [back, fL, fR] = boxes(spec)
  const [hL, hR] = cyls(spec)
  const { forearm: F, back: B, step } = CAPTAIN
  const eh = fL.center[1] + fL.size[1] / 2
  pad(kit, back, ZA)
  const postZ = -B.thick - 0.07
  const top = back.center[1] + B.len / 2 + 0.1
  for (const [f, h] of [[fL, hL], [fR, hR]] as const) {
    const x = f.center[0], s = Math.sign(x)
    pad(kit, f, YA)
    grip(kit, h)
    // rear post, arm under the forearm pad out to the handle, riser, front leg down and out
    const armY = eh - F.thick - 0.04
    kit.tube([x, 0.05, postZ], [x, top, postZ], 0.07, 0.07, 'frame', { cap: 'b' })
    kit.tube([x, armY, postZ], [x, armY, h.a[2] + 0.03], 0.06, 0.05, 'frame', { side: XA, cap: 'b' })
    kit.rod([x, armY + 0.02, h.a[2]], [x, h.a[1], h.a[2]], 0.018, 'steel', 20)
    const legTop = new Vector3(x, armY - 0.02, h.a[2] - 0.02)
    const legFoot = new Vector3(s * 0.34, 0.05, h.a[2] + 0.28)
    kit.tube(legTop, legFoot, 0.06, 0.06, 'frame')
    // side step on the front leg, outside the hanging legs
    const t = (step.y - legFoot.y) / (legTop.y - legFoot.y)
    const on = legFoot.clone().lerp(legTop, t)
    kit.box([s * step.x, step.y - 0.012, step.z], [0.12, 0.024, 0.16], 'rubber', undefined, 0.004)
    kit.tube(on, [s * step.x, step.y - 0.03, step.z], 0.03, 0.03, 'frame')
    rail(kit, s * 0.34, postZ - 0.3, legFoot.z + 0.08)
    kit.tube([x, 0.03, postZ], [s * 0.34, 0.03, postZ], 0.06, 0.05, 'frame', { side: ZA })
  }
  const x = fL.center[0]
  for (const y of [back.center[1] - 0.18, back.center[1] + 0.18]) kit.tube([-x + 0.035, y, postZ], [x - 0.035, y, postZ], 0.05, 0.05, 'frame', { side: ZA })
  kit.tube([-x + 0.035, top - 0.03, postZ], [x - 0.035, top - 0.03, postZ], 0.06, 0.06, 'frame', { side: ZA })
  for (const y of [back.center[1] - 0.18, back.center[1] + 0.18]) kit.tube([0, y, postZ + 0.025], [0, y, -B.thick - 0.012], 0.04, 0.04, 'frame', { side: XA })
  kit.tube([-0.3, 0.025, postZ - 0.25], [0.3, 0.025, postZ - 0.25], 0.07, 0.05, 'frame', { side: ZA })
  return finish(kit, socketsOf(spec, ['handle_l', 'handle_r']))
}

// ---------- decline bench ----------

export function buildDeclineBench(spec: ImplementSpec): PropBuild<StationSockets> {
  const kit = new Kit()
  const [back] = boxes(spec)
  const rollers = cyls(spec)
  const n = V(spec.sites.back.normal!), along = V(spec.sites.back.axis!)
  const board = pad(kit, back, n)
  const L = DECLINE_BENCH.pad.len
  // spine under the pad, posts at both ends, base rail and stabilisers
  const hiEnd = board.clone().addScaledVector(along, -L / 2 + 0.12).addScaledVector(n, -0.03)
  const loEnd = board.clone().addScaledVector(along, L / 2 - 0.12).addScaledVector(n, -0.03)
  kit.tube(hiEnd.clone().addScaledVector(along, -0.06), loEnd.clone().addScaledVector(along, 0.06), 0.07, 0.05, 'frame', { side: XA })
  kit.tube([0, 0.05, hiEnd.z], hiEnd, 0.07, 0.07, 'frame')
  kit.tube([0, 0.05, loEnd.z], loEnd, 0.07, 0.07, 'frame')
  // leg brace: a post in front of the rollers, short arms back to their axles between the legs
  const braceZ = Math.max(...rollers.map((r) => r.a[2])) + 0.1
  const braceTop = Math.max(0.3, ...rollers.map((r) => r.a[1])) + 0.04
  if (rollers.length) {
    kit.tube([0, 0.05, braceZ], [0, braceTop, braceZ], 0.06, 0.06, 'frame', { cap: 'b' })
    for (const r of rollers) {
      roller(kit, r, 0.01)
      kit.tube([0, r.a[1], braceZ - 0.03], [0, r.a[1], r.a[2]], 0.03, 0.04, 'frame', { side: XA })
    }
  }
  const z0 = loEnd.z - 0.12, z1 = (rollers.length ? braceZ : hiEnd.z) + 0.1
  kit.tube([0, 0.03, z0], [0, 0.03, z1], 0.08, 0.06, 'frame', { side: XA, cap: 'both' })
  for (const z of [z0 + 0.04, z1 - 0.04]) stabiliser(kit, z, 0.28)
  return finish(kit, socketsOf(spec, []))
}

// ---------- seal-row bench ----------

export function buildSealBench(spec: ImplementSpec): PropBuild<StationSockets> {
  const kit = new Kit()
  const [top, board] = boxes(spec)
  kit.box(top.center, top.size, 'pad', undefined, 0.024)
  kit.box(board.center, board.size, 'frameDark', undefined, 0.004)
  const under = board.center[1] - board.size[1] / 2
  const { len } = SEAL_BENCH
  // A-frame legs at both ends only: the middle stays open for the bar to reach the pad's underside
  for (const s of [-1, 1]) {
    // the legs at the very ends, so the bar hangs and rises clear of them under a lifter whose chin is past the end
    const z = s * (len / 2 - 0.03)
    kit.tube([-0.13, under - 0.025, z], [0.13, under - 0.025, z], 0.05, 0.05, 'frame', { side: ZA })
    for (const x of [-1, 1]) kit.tube([x * 0.11, under - 0.03, z], [x * 0.3, 0.05, z + s * 0.08], 0.05, 0.05, 'frame')
    stabiliser(kit, z + s * 0.08, 0.34)
    kit.tube([0, under - 0.05, z], [0, under - 0.05, z - s * 0.06], 0.04, 0.04, 'frame', { side: XA })
  }
  for (const x of [-1, 1]) kit.tube([x * 0.3, 0.06, -len / 2 - 0.05], [x * 0.3, 0.06, len / 2 + 0.05], 0.04, 0.04, 'frame', { side: XA })
  return finish(kit, socketsOf(spec, []))
}

// ---------- reverse hyper ----------

export function buildReverseHyper(spec: ImplementSpec): PropBuild<StationSockets> {
  const kit = new Kit()
  const [p] = boxes(spec)
  const [hL, hR] = cyls(spec)
  const pivot = V(spec.sites.pivot.pos)
  const board = pad(kit, p, YA)
  const { pad: P } = REVERSE_HYPER
  // side frames outside the pendulum: posts on the pivot line up to a cross member under the pad
  const sx = 0.34
  const under = board.y - 0.03
  for (const s of [-1, 1]) {
    kit.tube([s * sx, 0.05, pivot.z], [s * sx, under, pivot.z], 0.07, 0.07, 'frame')
    kit.rod([s * (sx - 0.035), pivot.y, pivot.z], [s * (sx - 0.08), pivot.y, pivot.z], 0.04, 'frameDark', 24)
    rail(kit, s * sx, -0.62, P.len + 0.2)
  }
  kit.tube([-sx - 0.035, under, pivot.z], [sx + 0.035, under, pivot.z], 0.07, 0.06, 'frame', { side: ZA, cap: 'both' })
  kit.rod([-sx + 0.035, pivot.y, pivot.z], [sx - 0.035, pivot.y, pivot.z], 0.016, 'steel', 16)
  kit.tube([0, under, pivot.z], [0, under, P.len - 0.06], 0.06, 0.05, 'frame', { side: XA })
  // front post with outriggers to the handles
  const fz = P.len - 0.08
  kit.tube([0, 0.05, fz], [0, under, fz], 0.07, 0.07, 'frame')
  for (const h of [hL, hR]) {
    grip(kit, h)
    kit.tube([0, h.a[1] - 0.03, fz], [h.a[0], h.a[1] - 0.03, h.a[2] + 0.03], 0.045, 0.04, 'frame', { side: YA })
    kit.rod([h.a[0], h.a[1] - 0.03, h.a[2] + 0.03], [h.a[0], h.a[1], h.a[2] + 0.03], 0.016, 'steel', 16)
  }
  for (const z of [-0.56, fz, P.len + 0.14]) kit.tube([-sx + 0.035, 0.025, z], [sx - 0.035, 0.025, z], 0.07, 0.05, 'frame', { side: ZA })
  kit.tube([0, 0.03, fz], [0, 0.03, pivot.z], 0.05, 0.05, 'frame', { side: XA })
  return finish(kit, socketsOf(spec, ['handle_l', 'handle_r']))
}

/** the pendulum in its frame (origin on the pivot): side arms, hubs, the padded roller, small loaded horns */
export function buildHyperLever(spec: ImplementSpec, o: { strap?: boolean } = {}): PropBuild<StationSockets> {
  const kit = new Kit()
  const [rol, armL, armR] = spec.parts as Cyl[]
  roller(kit, rol, 0.06)
  for (const a of [armL, armR]) {
    const s = Math.sign(a.a[0])
    kit.rod([a.a[0] - 0.03, 0, 0], [a.a[0] + 0.03, 0, 0], 0.04, 'frameDark', 24)
    kit.tube(a.a, a.b, 0.04, 0.04, 'frame', { side: XA })
    const low = V(a.b).lerp(V(a.a), 0.2)
    horn(kit, low.clone().setX(s * (Math.abs(a.a[0]) + 0.025)), low.clone().setX(s * (Math.abs(a.a[0]) + 0.22)), 1, 0.16, 0.035)
  }
  if (o.strap !== false) drawStrap(kit, spec)
  return finish(kit, socketsOf(spec, []))
}

/** the ankle strap (drawn only): a flat loop from the roller round the fronts of both ankles */
function drawStrap(kit: Kit, spec: ImplementSpec) {
  const r = V(spec.sites.roller.pos), s = V(spec.sites.strap.pos)
  const c = r.clone().lerp(s, 0.5).add(new Vector3(0, 0, 0.01))
  const rz = s.z - r.z + 0.04
  const tube = 0.1
  const m = new Matrix4().makeRotationX(-Math.PI / 2).scale(new Vector3(0.19, rz / 2 + 0.03, 0.05 / (2 * tube))).setPosition(c)
  kit.add(`torus:1:${tube}:${+(Math.PI * 2).toFixed(4)}`, 'pad', m)
}

// ---------- layouts ----------

/** a moving part drawn at its pose; `solid` without the drawn-only extras (`extra` adds them to `build`) */
function moving(key: string, holds: string[], solid: (poses: Poses) => Piece[], extra?: (poses: Poses) => Piece[]): MachineLayout {
  const id = new Matrix4()
  return {
    key,
    holds,
    fixed: false,
    build: (poses) => ({ placement: id, pieces: extra ? [...solid(poses), ...extra(poses)] : solid(poses) }),
    solid: (poses) => ({ placement: id, pieces: solid(poses) }),
  }
}

/** pieces built in a part's frame, placed at its pose */
function posed(pieces: Piece[], id: string) {
  return (poses: Poses) => new Kit().merge({ pieces }, poseMatrix4(poses.get(id)!)).pieces
}

const FIXED: Partial<Record<string, (s: ImplementSpec) => PropBuild<StationSockets>>> = {
  ghd: buildGhd,
  hack_squat: buildHackFrame,
  pendulum_squat: buildPendulumFrame,
  belt_squat: buildBeltSquat,
  preacher_bench: buildPreacher,
  tbar_station: buildTbarStation,
  captains_chair: buildCaptainsChair,
  decline_bench: buildDeclineBench,
  seal_bench: buildSealBench,
  reverse_hyper: buildReverseHyper,
}

/** stations you hang from are framed whole; stations with handles let the hands close round them */
const WHOLE = new Set(['captains_chair'])
const HELD = new Set(['belt_squat', 'captains_chair', 'reverse_hyper'])

export const layouts: LayoutSource = (b: Baked) => {
  const out: MachineLayout[] = []
  for (const spec of b.implements) {
    const fixed = FIXED[spec.kind]
    if (fixed) {
      out.push(fixedLayout(spec.id, poseMatrix4(firstPose(b, spec.id)!), fixed(spec).pieces, { holds: HELD.has(spec.kind) ? [spec.id] : [], whole: WHOLE.has(spec.kind) }))
      continue
    }
    switch (spec.kind) {
      case 'hack_sled':
        out.push(moving(spec.id, [spec.id], posed(buildHackSled(spec).pieces, spec.id)))
        break
      case 'pendulum_arm':
        out.push(moving(spec.id, [spec.id], posed(buildPendulumArm(spec).pieces, spec.id)))
        break
      case 'tbar_lever':
        out.push(moving(spec.id, [spec.id], posed(buildTbarLever(spec).pieces, spec.id)))
        break
      case 'hyper_lever': {
        const solid = posed(buildHyperLever(spec, { strap: false }).pieces, spec.id)
        const strap = new Kit()
        drawStrap(strap, spec)
        out.push(moving(spec.id, [], solid, posed(strap.pieces, spec.id)))
        break
      }
      case 'belt_lever': {
        const belt = b.implements.find((s) => s.kind === 'hip_belt')
        const solid = posed(buildBeltLever(spec).pieces, spec.id)
        const extra = belt
          ? (poses: Poses) => {
              const kit = new Kit()
              const bm = poseMatrix4(poses.get(belt.id)!)
              drawHipBelt(kit, belt, bm)
              const hook = V(spec.sites.hook.pos).add(new Vector3(0, 0.055, 0)).applyMatrix4(poseMatrix4(poses.get(spec.id)!))
              const ring = V(belt.sites.front.pos).add(new Vector3(0, -0.022, 0)).applyMatrix4(bm)
              drawChain(kit, ring, hook)
              return kit.pieces
            }
          : undefined
        out.push(moving(spec.id, [], solid, extra))
        break
      }
    }
  }
  return out
}

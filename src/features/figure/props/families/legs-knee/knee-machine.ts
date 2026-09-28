import { Matrix4, Quaternion, Vector3 } from 'three'
import type { ImplementSpec, Part } from '../../../../../motion/implements.ts'
import { KNEE_MACHINE } from '../../../../../motion/implements/legs-knee.ts'
import { finish, Kit, vec, type PropBuild, type Vec } from '../../kit.ts'
import { cableRun, foot, pulley, weightStack } from '../../parts.ts'

// Knee machines as the F5 templates lay them out (src/motion/implements/legs-knee.ts): pads, pivot and handles come
// from the implement specs, so the drawn machine is the one the QA gate collides with. World frame (the machine spec's
// pose is the identity), the lifter faces +Z; the pivot tower, lever and stack stand on the lifter's left (+X).

type Box = Extract<Part, { shape: 'box' }>
type Cyl = Extract<Part, { shape: 'cylinder' }>

const X = new Vector3(1, 0, 0)
const Y = new Vector3(0, 1, 0)
const Z = new Vector3(0, 0, 1)
const q4 = (r?: readonly number[]) => (r ? new Quaternion(r[0], r[1], r[2], r[3]) : new Quaternion())

/** pivot tower and stack, m */
export const TOWER = { x: 0.39, stackTop: 1.25, stackBack: 0.2 }
/** cable drum radius on the pivot: the stack lifts this much per radian of lever travel */
export const CAM_R = 0.07

/** black pad with its backing board on the side away from the body (`below`: the body is under the pad); returns the
 * pad's outward normal and the board's outer face centre */
export function drawPad(kit: Kit, b: Box, below = false) {
  const q = q4(b.rot)
  const n = Y.clone().applyQuaternion(q)
  if (below) n.negate()
  kit.box(b.center, b.size, 'pad', q, 0.024)
  const board = vec(b.center).addScaledVector(n, -(b.size[1] / 2 + 0.006))
  kit.box(board, [b.size[0] - 0.04, 0.012, b.size[2] - 0.04], 'frameDark', q, 0.004)
  return { n, q, under: board.addScaledVector(n, -0.006) }
}

/** a point on a box's surface: local (x, y, z) in half extents */
function onBox(b: Box, x: number, y: number, z: number) {
  return new Vector3((x * b.size[0]) / 2, (y * b.size[1]) / 2, (z * b.size[2]) / 2).applyQuaternion(q4(b.rot)).add(vec(b.center))
}

function tube(kit: Kit, a: Vec, b: Vec, w = 0.06, d = 0.06, side?: Vec, cap: 'both' | 'a' | 'b' | 'none' = 'none') {
  kit.tube(a, b, w, d, 'frame', { side, cap })
}

/** selectorized stack in a two-post frame, plates' long side along Z; returns the cable point on top */
export function stackTower(kit: Kit, at: Vector3, lift: number) {
  const s = new Kit()
  const top = weightStack(s, [0, 0, 0], { top: TOWER.stackTop - 0.06, lift, plates: 14, selected: 5 })
  const m = new Matrix4().makeRotationY(Math.PI / 2).setPosition(at.x, 0, at.z)
  kit.merge(s, m)
  const back = TOWER.stackBack
  for (const dz of [-back, back]) {
    tube(kit, [at.x, 0.05, at.z + dz], [at.x, TOWER.stackTop, at.z + dz], 0.06, 0.06)
    foot(kit, [at.x, 0, at.z + dz])
  }
  tube(kit, [at.x, 0.03, at.z - back - 0.03], [at.x, 0.03, at.z + back + 0.03], 0.07, 0.05, X, 'both')
  tube(kit, [at.x, TOWER.stackTop + 0.03, at.z - back - 0.03], [at.x, TOWER.stackTop + 0.03, at.z + back + 0.03], 0.07, 0.06, X, 'both')
  return top.applyMatrix4(m)
}

/** seated knee machine frame (leg extension, seated leg curl) around the spec's pads, pivot and handles */
export function buildSeatedKneeMachine(spec: ImplementSpec, handles: ImplementSpec | undefined, lift: number): PropBuild<Record<string, never>> {
  const kit = new Kit()
  const [seat, back, thigh] = spec.parts as Box[]
  const P = vec(spec.sites.pivot.pos)
  const tx = TOWER.x

  const s = drawPad(kit, seat)
  const b = drawPad(kit, back)
  const backLow = onBox(back, 0, -1, 1), backHigh = onBox(back, 0, -1, -1)
  const seatRear = onBox(seat, 0, -1, -1)
  const zRear = Math.min(backLow.z, backHigh.z, seatRear.z) - 0.12
  const zFront = P.z + 0.04

  // base: spine and cross feet
  tube(kit, [0, 0.025, zRear], [0, 0.025, zFront], 0.08, 0.05, X, 'both')
  for (const [z, x0, x1] of [[zRear + 0.04, -0.26, 0.26], [zFront - 0.04, -0.26, tx + 0.04]] as const) {
    tube(kit, [x0, 0.025, z], [x1, 0.025, z], 0.07, 0.05, Z, 'both')
    foot(kit, [x0 + 0.04, 0, z])
    foot(kit, [x1 - 0.04, 0, z])
  }
  // seat post and back strut
  const seatUnder = s.under.clone()
  tube(kit, [0, 0.05, seatUnder.z], [0, seatUnder.y - 0.01, seatUnder.z], 0.07, 0.07)
  tube(kit, [0, 0.05, seatUnder.z], [0, 0.26, seatUnder.z], 0.09, 0.09, undefined, 'b')
  const strutTop = onBox(back, 0, -1, 0.15).addScaledVector(b.n, -0.03)
  tube(kit, [0, 0.05, zRear + 0.06], strutTop, 0.06, 0.06)
  // recline bracket: seat rear to the back pad's lower end, a quadrant of adjustment holes beside it
  const hingeA = seatRear.clone().addScaledVector(s.n, -0.03)
  const hingeB = onBox(back, 0, -1, backLow.y < backHigh.y ? 0.85 : -0.85).addScaledVector(b.n, -0.03)
  tube(kit, hingeA, hingeB, 0.05, 0.05)
  const quad = hingeA.clone().lerp(hingeB, 0.5).setX(seat.size[0] / 2 + 0.015)
  kit.rod(hingeA.clone().lerp(hingeB, 0.5), quad, 0.012, 'steel', 16)
  kit.box(quad, [0.008, 0.14, 0.14], 'frameDark', undefined, 0.004)
  for (let k = 0; k < 5; k++) {
    const a = (-0.25 + (k * 0.5) / 4) * Math.PI
    kit.hole(quad.clone().add(new Vector3(0.0045, 0.05 * Math.sin(a), 0.05 * Math.cos(a))), X, 0.006)
  }
  kit.knob(quad.clone().add(new Vector3(0.005, -0.04, 0.03)), X, 0.013)

  // pivot tower on the left with the bearing housing on the knee axis
  tube(kit, [tx, 0.05, P.z], [tx, P.y + (thigh ? 0.2 : 0.06), P.z], 0.07, 0.07, undefined, 'b')
  kit.rod([tx - 0.045, P.y, P.z], [tx + 0.045, P.y, P.z], 0.05, 'frameDark', 32)
  kit.rod([tx + 0.045, P.y, P.z], [tx + 0.055, P.y, P.z], 0.03, 'steel', 24)
  tube(kit, [0.04, seatUnder.y - 0.05, seatUnder.z], [tx - 0.035, seatUnder.y - 0.05, P.z - 0.1], 0.05, 0.05)

  if (thigh) {
    // seated curl: the thigh pad hangs from an arm off the tower top
    drawPad(kit, thigh, true)
    const end = onBox(thigh, 1, 0, 0)
    kit.rod(end, end.clone().setX(tx - 0.03), 0.02, 'steel', 20)
    tube(kit, end.clone().setX(tx), [tx, P.y + 0.2, P.z], 0.06, 0.06)
    kit.knob([tx + 0.035, P.y + 0.14, P.z], X, 0.014)
  }

  // side handles on stays down to the seat frame
  if (handles) drawHandles(kit, handles, (stay) => [new Vector3(stay.x, seatUnder.y - 0.05, stay.z), new Vector3(Math.sign(stay.x) * 0.05, seatUnder.y - 0.05, seatUnder.z)])
  drawStack(kit, spec, P, zFront - 0.04, lift)
  return finish(kit, {})
}

/** rubber-gripped handle bars, each on a stay: from its rear end through `route(stayTop)` into the frame */
function drawHandles(kit: Kit, handles: ImplementSpec, route: (stay: Vector3) => Vector3[]) {
  for (const side of ['l', 'r'] as const) {
    const h = handles.sites[side]
    const c = vec(h.pos), ax = vec(h.axis!).normalize()
    const { len, r } = KNEE_MACHINE.handle
    const lo = c.clone().addScaledVector(ax, -len / 2), hi = c.clone().addScaledVector(ax, len / 2)
    kit.rod(lo, hi, r, 'rubber', 24)
    kit.sphere(hi, r + 0.003, 'rubber')
    const stay = lo.clone().addScaledVector(ax, -0.02)
    kit.rod(lo, stay, r * 0.9, 'steel', 20)
    let at = stay
    for (const next of route(stay)) {
      kit.rod(at, next, 0.017, 'frame', 20)
      kit.sphere(next, 0.017, 'frame')
      at = next
    }
  }
}

/** weight stack at the spec's `stack` site, joined to the base at z = baseZ; cable over the tower pulley to the drum */
function drawStack(kit: Kit, spec: ImplementSpec, P: Vector3, baseZ: number, lift: number) {
  const st = spec.sites.stack.pos
  const stackAt = new Vector3(st[0], 0, st[2])
  const top = stackTower(kit, stackAt, lift)
  const wheel = new Vector3(stackAt.x, TOWER.stackTop - 0.03, stackAt.z)
  pulley(kit, wheel, Z)
  const near = Math.max(stackAt.z - TOWER.stackBack, Math.min(stackAt.z + TOWER.stackBack, baseZ))
  if (Math.abs(near - baseZ) > 0.01) tube(kit, [stackAt.x, 0.025, baseZ], [stackAt.x, 0.025, near], 0.07, 0.05, X)
  tube(kit, [TOWER.x, 0.025, baseZ], [stackAt.x, 0.025, baseZ], 0.07, 0.05, Z)
  cableRun(kit, [top, wheel.clone().add(new Vector3(0, 0.045, 0)), new Vector3(0.335, P.y + CAM_R, P.z)])
}

/** prone leg curl: hip and chest pads on posts, pivot tower at the knees, handles under the front of the chest pad */
export function buildLyingKneeMachine(spec: ImplementSpec, handles: ImplementSpec | undefined, lift: number): PropBuild<Record<string, never>> {
  const kit = new Kit()
  const [hip, chest] = spec.parts as Box[]
  const P = vec(spec.sites.pivot.pos)
  const tx = TOWER.x
  const h = drawPad(kit, hip)
  const c = drawPad(kit, chest)
  const front = handles ? Math.max(...(['l', 'r'] as const).map((sd) => handles.sites[sd].pos[2])) + 0.12 : onBox(chest, 0, 0, 1).z + 0.1
  const z0 = P.z - 0.1, z1 = front
  tube(kit, [0, 0.025, z0], [0, 0.025, z1], 0.08, 0.05, X, 'both')
  for (const [z, x0, x1] of [[z0 + 0.04, -0.26, tx + 0.04], [z1 - 0.04, -0.26, 0.26]] as const) {
    tube(kit, [x0, 0.025, z], [x1, 0.025, z], 0.07, 0.05, Z, 'both')
    foot(kit, [x0 + 0.04, 0, z])
    foot(kit, [x1 - 0.04, 0, z])
  }
  // posts and a beam under the pads
  const hu = h.under.clone(), cu = c.under.clone()
  tube(kit, [0, 0.05, hu.z], [0, hu.y - 0.03, hu.z], 0.08, 0.08)
  tube(kit, [0, 0.05, cu.z], [0, cu.y - 0.03, cu.z], 0.08, 0.08)
  const hr = onBox(hip, 0, -1, -0.9).setY(hu.y - 0.03), cf = onBox(chest, 0, -1, 0.9).setY(cu.y - 0.03)
  tube(kit, hr, [0, hu.y - 0.03, hu.z + hip.size[2] / 2], 0.06, 0.05, X)
  tube(kit, [0, hu.y - 0.03, hu.z + hip.size[2] / 2 - 0.03], [0, cu.y - 0.03, cu.z - chest.size[2] / 2 + 0.03], 0.06, 0.05, X)
  tube(kit, [0, cu.y - 0.03, cu.z - chest.size[2] / 2], cf, 0.06, 0.05, X)
  // pivot tower at the knees
  tube(kit, [tx, 0.05, P.z], [tx, P.y + 0.06, P.z], 0.07, 0.07, undefined, 'b')
  kit.rod([tx - 0.045, P.y, P.z], [tx + 0.045, P.y, P.z], 0.05, 'frameDark', 32)
  kit.rod([tx + 0.045, P.y, P.z], [tx + 0.055, P.y, P.z], 0.03, 'steel', 24)
  tube(kit, [tx - 0.035, hr.y - 0.1, P.z], [0.04, hr.y - 0.1, hr.z], 0.05, 0.05)
  // handles below the front of the chest pad, stays down to a front post
  if (handles) {
    const postTop = new Vector3(0, 0.4, z1 - 0.08)
    tube(kit, [0, 0.05, postTop.z], postTop, 0.07, 0.07, undefined, 'b')
    drawHandles(kit, handles, (stay) => [new Vector3(stay.x, postTop.y, stay.z), new Vector3(Math.sign(stay.x) * 0.035, postTop.y, postTop.z)])
  }
  drawStack(kit, spec, P, z0 + 0.04, lift)
  return finish(kit, {})
}

/** the lever in its own frame (pivot at the origin, +Z along the straight shin): roller, axle, arm and drum */
export function buildKneeLever(spec: ImplementSpec): PropBuild<Record<string, never>> {
  const kit = new Kit()
  const roller = spec.parts[0] as Cyl
  const { arm, pivot } = KNEE_MACHINE
  const c = new Vector3(0, roller.a[1], roller.a[2])
  kit.rod(roller.a, roller.b, roller.r, 'pad', 32)
  for (const x of [roller.a[0], roller.b[0]]) kit.rod([x - 0.004 * Math.sign(x), c.y, c.z], [x + 0.006 * Math.sign(x), c.y, c.z], roller.r * 0.55, 'frameDark', 24)
  kit.rod([roller.b[0], c.y, c.z], [arm.x - arm.w / 2, c.y, c.z], 0.014, 'steel', 16)
  const dir = c.clone().normalize()
  tube(kit, new Vector3(arm.x, 0, 0).addScaledVector(dir, -0.04), new Vector3(arm.x, c.y, c.z).addScaledVector(dir, 0.04), arm.w, arm.w, X, 'both')
  kit.rod([pivot.x - 0.03, 0, 0], [pivot.x + 0.03, 0, 0], pivot.r, 'frameDark', 40)
  kit.rod([pivot.x - 0.034, 0, 0], [pivot.x + 0.034, 0, 0], 0.028, 'steel', 24)
  return finish(kit, {})
}

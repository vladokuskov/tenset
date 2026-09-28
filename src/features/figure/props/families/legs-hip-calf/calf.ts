import { Matrix4, Quaternion, Vector3 } from 'three'
import type { ImplementSpec, Part } from '../../../../../motion/implements.ts'
import { CALF_SEATED, CALF_STANDING } from '../../../../../motion/implements/legs-hip-calf.ts'
import { finish, Kit, vec, type PropBuild, type Vec } from '../../kit.ts'
import { cableRun, foot, pulley, weightStack } from '../../parts.ts'

// Calf machines drawn around the calf-raise template's implements (src/motion/implements/legs-hip-calf.ts), in world
// coordinates: the lifter faces +Z with the balls of the feet on the foot bar's top line.

type V3 = [number, number, number]
type Box = Extract<Part, { shape: 'box' }>
type Cyl = Extract<Part, { shape: 'cylinder' }>

const X = new Vector3(1, 0, 0)
const Y = new Vector3(0, 1, 0)
const Z = new Vector3(0, 0, 1)

/** padded roller the forefoot rests on, with steel end caps, from the implement's cylinder */
function footRoller(kit: Kit, bar: ImplementSpec) {
  const c = bar.parts[0] as Cyl
  kit.rod(c.a, c.b, c.r, 'pad', 40)
  for (const e of [c.a, c.b]) {
    const s = Math.sign(e[0])
    kit.rod(e, vec(e).add(new Vector3(s * 0.012, 0, 0)), c.r + 0.004, 'steelDark', 32)
  }
  return c
}

/** black pad with its backing board on the `normal` side (box frame) */
export function padBox(kit: Kit, box: Box, m: Matrix4, normal: Vec = Y) {
  const pos = new Vector3(), rot = new Quaternion(), s = new Vector3()
  m.decompose(pos, rot, s)
  const q = rot.clone().multiply(box.rot ? new Quaternion(...box.rot) : new Quaternion())
  const c = vec(box.center).applyMatrix4(m)
  kit.box(c, box.size, 'pad', q, 0.022)
  const n = vec(normal).applyQuaternion(q)
  kit.box(c.clone().addScaledVector(n, box.size[1] / 2 + 0.006), [box.size[0] - 0.02, 0.012, box.size[2] - 0.02], 'frameDark', q, 0.004)
}

export type StandingCalfParams = {
  bar: ImplementSpec
  yoke: ImplementSpec
  /** yoke origin: between the shoulder pad bottoms */
  at: V3
  /** carriage lift above its lowest point (weight stack), m */
  lift: number
}

/** Standing calf machine: foot roller, a yoke with shoulder pads and drop handles on a carriage riding two guide rods
 * in the frame in front of the lifter, weight stack behind the guides. */
export function buildStandingCalf(p: StandingCalfParams): PropBuild<Record<string, never>> {
  const kit = new Kit()
  const c = footRoller(kit, p.bar)
  const gz = CALF_STANDING.guideZ
  // kept low enough that the frame top stays near the picture
  const railX = 0.36, backZ = -0.12, frontZ = 0.95, postZ = 0.86, top = 1.98
  // base rails, feet, cross tubes
  for (const s of [-1, 1]) {
    kit.tube([s * railX, 0.025, backZ], [s * railX, 0.025, frontZ], 0.07, 0.05, 'frame', { side: X, cap: 'both' })
    foot(kit, [s * railX, 0, backZ + 0.03])
    foot(kit, [s * railX, 0, frontZ - 0.03])
    // roller brackets: flat bars from the roller ends down to the rails
    const end = vec(s > 0 ? (c.a[0] > 0 ? c.a : c.b) : c.a[0] < 0 ? c.a : c.b).add(new Vector3(s * 0.02, 0, 0))
    kit.tube(end, [s * railX, 0.05, 0.3], 0.03, 0.06, 'frame', { side: X })
    kit.tube([s * railX, 0.05, postZ], [s * railX, top, postZ], 0.08, 0.08, 'frame', { cap: 'b' })
  }
  for (const z of [0.3, postZ]) kit.tube([-railX + 0.035, 0.025, z], [railX - 0.035, 0.025, z], 0.07, 0.05, 'frame', { side: Z })
  kit.tube([-railX - 0.04, top + 0.04, postZ], [railX + 0.04, top + 0.04, postZ], 0.08, 0.08, 'frame', { side: Z, cap: 'both' })
  // guide rods between a low and a high bracket tied back to the uprights
  const lo = 0.5, hi = 1.88
  for (const y of [lo, hi]) {
    kit.tube([-0.16, y, gz], [0.16, y, gz], 0.06, 0.05, 'frame', { side: Z, cap: 'both' })
    for (const s of [-1, 1]) kit.tube([s * 0.13, y, gz], [s * 0.13, y, postZ - 0.04], 0.05, 0.05, 'frame', { side: X })
    kit.tube([-railX + 0.04, y, postZ], [railX - 0.04, y, postZ], 0.05, 0.05, 'frame', { side: Z })
  }
  for (const s of [-1, 1]) kit.rod([s * 0.1, lo, gz], [s * 0.1, hi, gz], 0.013, 'steel', 20)
  // weight stack between the guides and the uprights, cable over the head to the carriage
  const sz = (gz + postZ) / 2 + 0.02
  const stackTop = weightStack(kit, [0, 0, sz], { top: hi - 0.1, lift: p.lift, plates: 12 })
  // carriage and yoke
  const at = vec(p.at)
  const m = new Matrix4().setPosition(at)
  const padTop = at.y + CALF_STANDING.pad.size[1] + 0.012
  const armY = padTop + 0.025
  const carriage = new Vector3(0, armY, gz)
  kit.box(carriage, [0.3, 0.14, 0.1], 'frameDark', undefined, 0.012)
  for (const s of [-1, 1]) kit.rod([s * 0.1, armY - 0.075, gz], [s * 0.1, armY + 0.075, gz], 0.02, 'steelDark', 20)
  const [padL, handleL, padR, handleR] = p.yoke.parts as [Box, Cyl, Box, Cyl]
  for (const [pad, handle] of [[padL, handleL], [padR, handleR]] as const) {
    padBox(kit, pad, m)
    const x = pad.center[0]
    kit.tube([x, armY, at.z + pad.center[2] - pad.size[2] / 2 + 0.02], [x, armY, gz - 0.05], 0.05, 0.05, 'frame', { side: X, cap: 'a' })
    const ht = vec(handle.a).applyMatrix4(m), hb = vec(handle.b).applyMatrix4(m)
    const upper = ht.y > hb.y ? ht : hb, lower = ht.y > hb.y ? hb : ht
    kit.rod(new Vector3(x, armY, upper.z), upper.clone().add(new Vector3(0, 0.02, 0)), 0.018, 'frame', 20)
    kit.sphere(new Vector3(x, armY, upper.z), 0.026, 'frame')
    kit.rod(upper, lower, handle.r, 'rubber', 24)
    kit.rod(lower, lower.clone().add(new Vector3(0, -0.012, 0)), handle.r + 0.004, 'rubber', 24)
  }
  const wheelY = top - 0.07
  pulley(kit, [0, wheelY, sz], X)
  pulley(kit, [0, wheelY, gz + 0.06], X)
  cableRun(kit, [stackTop, new Vector3(0, wheelY, sz)])
  cableRun(kit, [new Vector3(0, wheelY + 0.045, sz), new Vector3(0, wheelY + 0.045, gz + 0.06)])
  cableRun(kit, [new Vector3(0, wheelY, gz + 0.015), carriage.clone().add(new Vector3(0, 0.07, -0.035))])
  return finish(kit, {})
}

export type SeatedCalfParams = {
  seat: ImplementSpec
  bar: ImplementSpec
  lever: ImplementSpec
  /** lever pivot and pose (rotation about X) */
  pivot: V3
  rot: [number, number, number, number]
}

/** Seated calf machine: seat on a pedestal, foot roller, and a knee-pad lever pivoting on a post ahead of the knees
 * with plate horns beside the pads and grips on top. */
export function buildSeatedCalf(p: SeatedCalfParams): PropBuild<Record<string, never>> {
  const kit = new Kit()
  const c = footRoller(kit, p.bar)
  const seat = p.seat.parts[0] as Box
  const P = vec(p.pivot)
  const railX = 0.34, backZ = seat.center[2] - 0.3, frontZ = P.z + 0.16
  for (const s of [-1, 1]) {
    kit.tube([s * railX, 0.025, backZ], [s * railX, 0.025, frontZ], 0.07, 0.05, 'frame', { side: X, cap: 'both' })
    foot(kit, [s * railX, 0, backZ + 0.03])
    foot(kit, [s * railX, 0, frontZ - 0.03])
    const end = vec(s > 0 ? (c.a[0] > 0 ? c.a : c.b) : c.a[0] < 0 ? c.a : c.b).add(new Vector3(s * 0.02, 0, 0))
    kit.tube(end, [s * railX, 0.05, end.z + 0.12], 0.03, 0.06, 'frame', { side: X })
    kit.tube(end, [s * railX, 0.05, end.z - 0.12], 0.03, 0.06, 'frame', { side: X })
  }
  for (const z of [backZ + 0.08, seat.center[2], P.z]) kit.tube([-railX + 0.035, 0.025, z], [railX - 0.035, 0.025, z], 0.07, 0.05, 'frame', { side: Z })
  // seat pedestal and pad
  padBox(kit, seat, new Matrix4(), Y.clone().negate())
  kit.tube([0, 0.05, seat.center[2]], [0, seat.center[1] - seat.size[1] / 2 - 0.012, seat.center[2]], 0.08, 0.08, 'frame')
  // pivot post and hub
  kit.tube([0, 0.05, P.z], [0, P.y - 0.03, P.z], 0.08, 0.08, 'frame')
  kit.rod(P.clone().setX(-0.08), P.clone().setX(0.08), 0.035, 'frameDark', 32)
  // lever: arm from the hub to a cross tube on the pad, plate horns at the tube ends, grips standing on it
  const lrot = new Quaternion(...p.rot)
  const m = new Matrix4().compose(P, lrot, new Vector3(1, 1, 1))
  const [pad, ...handles] = p.lever.parts as [Box, ...Cyl[]]
  padBox(kit, pad, m)
  const padRot = pad.rot ? new Quaternion(...pad.rot) : new Quaternion()
  const up = Y.clone().applyQuaternion(padRot)
  const { frame } = CALF_SEATED
  const frameC = vec(pad.center).addScaledVector(up, pad.size[1] / 2 + 0.012 + frame.t / 2)
  const L = (v: Vec) => vec(v).applyMatrix4(m)
  const upW = up.clone().applyQuaternion(lrot)
  kit.tube(L(frameC.clone().setX(-frame.half)), L(frameC.clone().setX(frame.half)), frame.t, frame.t, 'frame', { side: upW, cap: 'both' })
  kit.tube(L([0, 0, 0]), L(frameC), 0.07, 0.06, 'frame', { side: X })
  for (const s of [-1, 1]) {
    // plates out past the grips, clear of the forearms
    const hornA = frameC.clone().setX(s * frame.half), hornB = frameC.clone().setX(s * (frame.half + 0.2))
    kit.rod(L(hornA), L(hornB), 0.025, 'steel', 24)
    kit.rod(L(hornA.clone().setX(s * (frame.half + 0.07))), L(hornA.clone().setX(s * (frame.half + 0.082))), 0.042, 'frameDark', 32)
    kit.plate(L(hornA.clone().setX(s * (frame.half + 0.085))), X.clone().multiplyScalar(s), 0.13, 0.035)
  }
  for (const h of handles) {
    const a = vec(h.a), b = vec(h.b)
    const lo = a.clone().sub(frameC).dot(up) < b.clone().sub(frameC).dot(up) ? a : b
    const hi = lo === a ? b : a
    kit.rod(L(frameC.clone().setX(lo.x)), L(lo), 0.014, 'frame', 16)
    kit.rod(L(lo), L(hi), h.r, 'rubber', 24)
    kit.sphere(L(hi), h.r + 0.003, 'rubber')
  }
  return finish(kit, {})
}

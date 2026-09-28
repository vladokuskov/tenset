import { Matrix4, Quaternion, Vector3 } from 'three'
import type { ImplementSpec, Part } from '../../../../../motion/implements.ts'
import { finish, Kit, vec, type PropBuild, type Vec } from '../../kit.ts'
import { cableRun, foot, pulley, weightStack } from '../../parts.ts'
import { padBox } from './calf.ts'

// Seated hip abduction / adduction machine drawn around the hip-abduction template's implements
// (src/motion/implements/legs-hip-calf.ts), world frame, the lifter faces +Z. One machine: each leg arm turns about a
// vertical hub under its hip joint and carries a thigh pad (outside the knee for abduction, inside for adduction) and a
// foot peg; the stack stands behind the back pad.

type V3 = [number, number, number]
type Box = Extract<Part, { shape: 'box' }>
type Cyl = Extract<Part, { shape: 'cylinder' }>

const X = new Vector3(1, 0, 0)
const Y = new Vector3(0, 1, 0)
const Z = new Vector3(0, 0, 1)

/** stack tower behind the back pad, m */
export const HIP_TOWER = { z: -0.52, halfX: 0.22, top: 1.42 }
/** leg arm tube height relative to the hip joint, and the outboard drop to the foot peg (arm frame), m */
const ARM = { y: -0.25, drop: 0.13 }

export type HipMachineParams = {
  seat: ImplementSpec
  arms: { spec: ImplementSpec; side: 'l' | 'r'; pos: V3; rot: [number, number, number, number] }[]
  /** stack lift, m */
  lift: number
}

function tube(kit: Kit, a: Vec, b: Vec, w = 0.05, d = 0.05, side?: Vec, cap: 'both' | 'a' | 'b' | 'none' = 'none') {
  kit.tube(a, b, w, d, 'frame', { side, cap })
}

/** one leg arm in its own frame (origin on the hip joint), placed by `m` */
function drawArm(kit: Kit, spec: ImplementSpec, side: 'l' | 'r', m: Matrix4) {
  const [pad, peg] = spec.parts as [Box, Cyl]
  const s = side === 'l' ? 1 : -1
  const L = (v: Vec) => vec(v).applyMatrix4(m)
  const q = new Quaternion().setFromRotationMatrix(m)
  const zc = pad.center[2]
  const px = pad.center[0]
  const o = Math.sign(px)
  const out = s * 0.13
  // hub collar under the hip joint, arm tube forward under the thigh, cross tube under the pad
  kit.rod(L([0, ARM.y - 0.035, 0]), L([0, ARM.y + 0.035, 0]), 0.034, 'frameDark', 32)
  tube(kit, L([0, ARM.y, 0]), L([0, ARM.y, zc]), 0.05, 0.05, Y.clone().applyQuaternion(q), 'b')
  const xs = [0, px, out]
  tube(kit, L([Math.min(...xs) - 0.025, ARM.y, zc]), L([Math.max(...xs) + 0.025, ARM.y, zc]), 0.05, 0.05, Y.clone().applyQuaternion(q), 'both')
  // thigh pad on a post, its backing board on the side away from the knee
  const padBottom = pad.center[1] - pad.size[1] / 2
  tube(kit, L([px, ARM.y, zc]), L([px, padBottom - 0.01, zc]), 0.04, 0.04, Z.clone().applyQuaternion(q))
  kit.box(L(pad.center), pad.size, 'pad', q, 0.022)
  kit.box(L([px + o * (pad.size[0] / 2 + 0.006), pad.center[1], zc]), [0.012, pad.size[1] - 0.02, pad.size[2] - 0.02], 'frameDark', q, 0.004)
  kit.box(L([px, padBottom - 0.006, zc]), [0.05, 0.012, 0.1], 'frameDark', q, 0.004)
  // outboard drop to the foot peg, peg with a steel stub to the drop
  const pc: V3 = [(peg.a[0] + peg.b[0]) / 2, peg.a[1], peg.a[2]]
  const top: V3 = [out, ARM.y, zc], bottom: V3 = [out, pc[1], pc[2]]
  const knee: V3 = [out, pc[1] + ARM.drop, pc[2] - 0.02]
  tube(kit, L(top), L(knee), 0.04, 0.04, X.clone().applyQuaternion(q))
  tube(kit, L(knee), L(bottom), 0.04, 0.04, X.clone().applyQuaternion(q), 'b')
  kit.rod(L(peg.a), L(peg.b), peg.r, 'pad', 32)
  const endX = s * Math.max(Math.abs(peg.a[0]), Math.abs(peg.b[0]))
  kit.rod(L([endX, pc[1], pc[2]]), L([out, pc[1], pc[2]]), 0.014, 'steel', 16)
  kit.rod(L([-endX, pc[1], pc[2]]), L([-endX - s * 0.01, pc[1], pc[2]]), peg.r + 0.004, 'rubber', 24)
}

export function buildHipMachine(p: HipMachineParams): PropBuild<Record<string, never>> {
  const kit = new Kit()
  const [seat, back, ...handles] = p.seat.parts as [Box, Box, ...Cyl[]]
  const hubY = p.arms[0].pos[1] + ARM.y
  const seatLow = seat.center[1] - seat.size[1] / 2 - 0.02
  const tz = HIP_TOWER.z
  // base: spine from the tower to the front cross foot
  const frontZ = 0.34
  tube(kit, [0, 0.025, tz - 0.12], [0, 0.025, frontZ], 0.08, 0.05, X, 'both')
  for (const z of [tz, frontZ - 0.04]) {
    tube(kit, [-0.3, 0.025, z], [0.3, 0.025, z], 0.07, 0.05, Z, 'both')
    foot(kit, [-0.26, 0, z])
    foot(kit, [0.26, 0, z])
  }
  // seat on a pedestal, hub beam across under it with a bearing housing under each hip
  padBox(kit, seat, new Matrix4(), Y.clone().negate())
  tube(kit, [0, 0.05, seat.center[2]], [0, seatLow, seat.center[2]], 0.08, 0.08)
  const beamY = hubY - 0.07
  tube(kit, [-0.19, beamY, 0], [0.19, beamY, 0], 0.06, 0.06, Z, 'both')
  for (const a of p.arms) kit.rod([a.pos[0], beamY + 0.03, a.pos[2]], [a.pos[0], hubY - 0.035, a.pos[2]], 0.03, 'frame', 32)
  // back pad on a strut from the base
  padBox(kit, back, new Matrix4(), Y.clone().negate())
  const bq = new Quaternion(...(back.rot ?? [0, 0, 0, 1]))
  const behind = Y.clone().applyQuaternion(bq).negate()
  const backC = vec(back.center)
  const strutTop = backC.clone().addScaledVector(behind, back.size[1] / 2 + 0.04).addScaledVector(Y, -0.08)
  tube(kit, [0, 0.05, tz + 0.1], strutTop, 0.07, 0.07)
  tube(kit, [0, seatLow, seat.center[2] - 0.12], [0, seatLow + 0.12, strutTop.z + 0.02], 0.06, 0.06)
  // side handles on posts from a cross tube under the seat
  for (const h of handles) {
    const a = vec(h.a), b = vec(h.b)
    const rear = a.z < b.z ? a : b, fore = a.z < b.z ? b : a
    kit.rod(rear, fore, h.r, 'rubber', 24)
    kit.sphere(fore, h.r + 0.003, 'rubber')
    const foot0 = new Vector3(rear.x, seatLow - 0.04, rear.z)
    kit.rod(rear.clone().addScaledVector(Z, -0.012), foot0, 0.018, 'frame', 20)
    kit.sphere(rear.clone().addScaledVector(Z, -0.012), 0.018, 'frame')
  }
  const hz = Math.min(...handles.map((h) => Math.min(h.a[2], h.b[2]))) - 0.012
  const hx = Math.max(...handles.map((h) => Math.abs(h.a[0])))
  tube(kit, [-hx - 0.02, seatLow - 0.04, hz], [hx + 0.02, seatLow - 0.04, hz], 0.05, 0.05, Z, 'both')
  // stack tower behind the back pad, cable over the top and down to a cam under the seat
  for (const x of [-HIP_TOWER.halfX, HIP_TOWER.halfX]) {
    tube(kit, [x, 0.05, tz], [x, HIP_TOWER.top, tz], 0.06, 0.06)
    foot(kit, [x, 0, tz])
  }
  tube(kit, [-HIP_TOWER.halfX - 0.03, HIP_TOWER.top + 0.03, tz], [HIP_TOWER.halfX + 0.03, HIP_TOWER.top + 0.03, tz], 0.06, 0.06, Z, 'both')
  const stackTop = weightStack(kit, [0, 0, tz], { top: HIP_TOWER.top - 0.05, lift: p.lift, plates: 14, selected: 5 })
  const wheel = new Vector3(0, HIP_TOWER.top - 0.07, tz)
  pulley(kit, wheel, X)
  pulley(kit, [0, 0.14, tz + 0.1], X)
  cableRun(kit, [stackTop, wheel.clone().add(new Vector3(0, 0, -0.045))])
  cableRun(kit, [wheel.clone().add(new Vector3(0, 0, 0.045)), new Vector3(0, 0.14, tz + 0.145)])
  cableRun(kit, [new Vector3(0, 0.185, tz + 0.1), new Vector3(0, beamY - 0.03, -0.03)])
  kit.rod([0, beamY - 0.06, 0], [0, beamY - 0.03, 0], 0.06, 'frameDark', 32)
  for (const a of p.arms) drawArm(kit, a.spec, a.side, new Matrix4().compose(vec(a.pos), new Quaternion(...a.rot), new Vector3(1, 1, 1)))
  return finish(kit, {})
}

/** grab handle on its brackets (implement frame): rubber grip, round brackets back to the upright with end plates */
export function buildGrabHandle(spec: ImplementSpec): PropBuild<Record<string, never>> {
  const kit = new Kit()
  const [grip, ...brackets] = spec.parts as Cyl[]
  kit.rod(grip.a, grip.b, grip.r, 'rubber', 24)
  for (const e of [grip.a, grip.b]) kit.sphere(e, grip.r + 0.002, 'rubber')
  for (const br of brackets) {
    kit.rod(br.a, br.b, br.r, 'frame', 20)
    const d = vec(br.b).sub(vec(br.a)).normalize()
    kit.rod(br.b, vec(br.b).addScaledVector(d, 0.008), 0.03, 'frameDark', 24)
  }
  return finish(kit, {})
}

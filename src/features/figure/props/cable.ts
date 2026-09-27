import { Quaternion, Vector3 } from 'three'
import { cableHandle, type Attachment, type ImplementSpec, type Part } from '../../../motion/implements.ts'
import { finish, Kit, poseMatrix, vec, type PropBuild, type Vec } from './kit.ts'
import { cableExit, cableRun, foot, hangingRotation, holeRow, horizontalTowards, pulley, WHEEL_R, weightStack } from './parts.ts'
import { gripSocket, type CableSocket, type GripSocket } from './sockets.ts'

// Cable attachments (drawn from src/motion/implements.ts cableHandle descriptors: origin at the carabiner, handles
// hang towards -Y) and a single-column cable stack with an adjustable pulley that draws the cable to its attachment.

type Cyl = Extract<Part, { shape: 'cylinder' }>
const cyls = (spec: ImplementSpec) => spec.parts.filter((p): p is Cyl => p.shape === 'cylinder')

/** where the cable ends on every attachment (top of the stop ball above the carabiner), attachment frame */
export const ATTACHMENT_EYE = new Vector3(0, 0.061, 0)

export type AttachmentSockets = { grips: Record<string, GripSocket>; eye: Vector3; spec: ImplementSpec }

/** EZ attachment camber: grip segments turn by this angle (implements.ts draws the attachment straight) */
const EZ_TILT = (14 * Math.PI) / 180

function carabiner(kit: Kit) {
  kit.torus([0, 0.018, 0], 0.016, 0.0035, [0, 0, 1], 'steel')
  kit.rod([0, 0.032, 0], [0, 0.046, 0], 0.0055, 'steel', 12)
  kit.sphere([0, 0.05, 0], 0.011, 'rubber')
}

function barAttachment(kit: Kit, spec: ImplementSpec) {
  const [stem, bar] = cyls(spec)
  const y = bar.a[1], r = bar.r, w = Math.abs(bar.b[0])
  const gs = Math.min(...Object.values(spec.sites).map((s) => Math.abs(s.pos[0])))
  const g0 = Math.max(0.05, gs - 0.1)
  kit.rod(stem.a, [0, y + 0.012, 0], stem.r, 'steel', 16)
  kit.box([0, y, 0], [0.034, 0.03, 0.036], 'steelDark', undefined, 0.006)
  kit.rod([-g0, y, 0], [g0, y, 0], r, 'steel')
  for (const s of [-1, 1]) {
    kit.knurl([s * g0, y, 0], [s * (w - 0.012), y, 0], r)
    kit.rod([s * (w - 0.012), y, 0], [s * w, y, 0], r + 0.0015, 'steel')
  }
}

function ezAttachment(kit: Kit, spec: ImplementSpec): Record<string, GripSocket> {
  const [stem, bar] = cyls(spec)
  const y = bar.a[1], r = bar.r, w = Math.abs(bar.b[0])
  const xs = Math.abs(spec.sites.l.pos[0])
  const t = Math.tan(EZ_TILT)
  const x0 = xs - 0.07
  const zc = -0.07 * t, ze = (w - xs) * t
  kit.rod(stem.a, [0, y + 0.012, zc], stem.r, 'steel', 16)
  kit.box([0, y, zc], [0.034, 0.03, 0.036], 'steelDark', undefined, 0.006)
  kit.rod([-x0, y, zc], [x0, y, zc], r, 'steel')
  for (const s of [-1, 1]) {
    const inner = new Vector3(s * x0, y, zc), outer = new Vector3(s * w, y, ze)
    const dir = outer.clone().sub(inner).normalize()
    kit.knurl(inner, outer.clone().addScaledVector(dir, -0.012), r)
    kit.rod(outer.clone().addScaledVector(dir, -0.012), outer, r + 0.0015, 'steel')
    kit.sphere(inner, r * 1.003, 'grip')
  }
  const axis = (s: number) => new Vector3(1, 0, s * t).normalize()
  return {
    l: { position: new Vector3(xs, y, 0), axis: axis(1) },
    r: { position: new Vector3(-xs, y, 0), axis: axis(-1) },
  }
}

function vBar(kit: Kit, spec: ImplementSpec) {
  const [stem, ...handles] = cyls(spec)
  const top = -0.04
  kit.rod(stem.a, [0, top, 0], stem.r, 'steel', 16)
  const hx = Math.abs(handles[0].a[0])
  kit.rod([-hx, top, 0], [hx, top, 0], 0.01, 'steel', 16)
  kit.sphere([0, top, 0], 0.014, 'steel')
  for (const h of handles) {
    const x = h.a[0], y = h.a[1], z = Math.max(Math.abs(h.a[2]), Math.abs(h.b[2]))
    kit.knurl([x, y, -z], [x, y, z], h.r)
    for (const s of [-1, 1]) {
      kit.rod([x, y, s * z], [x, y, s * (z + 0.008)], h.r + 0.004, 'steel', 20)
      kit.rod([x, top, 0], [x, y, s * (z + 0.004)], 0.0075, 'steel', 12)
    }
    kit.sphere([x, top, 0], 0.011, 'steel')
  }
}

function dHandle(kit: Kit, spec: ImplementSpec) {
  const grip = cyls(spec)[2]
  const y = grip.a[1], half = Math.abs(grip.a[0])
  for (const s of [-1, 1]) {
    kit.rod([0, -0.004, 0], [s * (half + 0.006), y, 0], 0.0065, 'steel', 12)
    kit.rod([s * half, y, 0], [s * (half + 0.011), y, 0], 0.012, 'steel', 20)
  }
  kit.sphere([0, -0.004, 0], 0.009, 'steel')
  kit.knurl([-half, y, 0], [half, y, 0], grip.r)
}

function rope(kit: Kit, spec: ImplementSpec) {
  kit.rod([0, 0.004, 0], [0, -0.03, 0], 0.017, 'steel', 24)
  for (const s of cyls(spec)) {
    const end = vec(s.b)
    const dir = end.clone().sub(vec(s.a)).normalize()
    kit.rod([0, -0.02, 0], end, s.r, 'rope', 16)
    kit.rod(end.clone().addScaledVector(dir, -0.006), end.clone().addScaledVector(dir, 0.034), s.r + 0.009, 'rubber', 24)
    kit.sphere(end.clone().addScaledVector(dir, 0.034), s.r + 0.009, 'rubber')
  }
}

function ankleStrap(kit: Kit, spec: ImplementSpec): Record<string, GripSocket> {
  const c = vec(spec.sites.c.pos)
  kit.torus([0, -0.006, 0], 0.012, 0.0025, [0, 0, 1], 'steel')
  kit.box([0, c.y + 0.049, 0], [0.03, 0.016, 0.007], 'rubber', undefined, 0.002)
  kit.profile([[0.042, 0], [0.047, 0], [0.052, 0.006], [0.052, 0.064], [0.047, 0.07], [0.042, 0.07], [0.042, 0]], c.clone().setX(-0.035), [1, 0, 0], 'pad')
  return { c: { position: c, axis: new Vector3(1, 0, 0) } }
}

export type AttachmentKind = Attachment

/** A cable attachment in its own frame: carabiner at the origin, grips below. */
export function buildAttachment(kind: AttachmentKind, spec = cableHandle({ attachment: kind })): PropBuild<AttachmentSockets> {
  const kit = new Kit()
  carabiner(kit)
  let grips: Record<string, GripSocket> | undefined
  switch (kind) {
    case 'rope': rope(kit, spec); break
    case 'straight_bar':
    case 'long_bar': barAttachment(kit, spec); break
    case 'ez_bar': grips = ezAttachment(kit, spec); break
    case 'v_bar': vBar(kit, spec); break
    case 'single_handle': dHandle(kit, spec); break
    case 'ankle_strap': grips = ankleStrap(kit, spec); break
  }
  grips ??= Object.fromEntries(Object.entries(spec.sites).map(([k, s]) => [k, gripSocket(s)]))
  return finish(kit, { grips, eye: ATTACHMENT_EYE.clone(), spec })
}

type Q = [number, number, number, number]

/** attachment origin pose in a machine's frame; without `rot` it hangs with +Y towards the pulley */
export type HandlePose = { pos: Vec; rot?: Quaternion | Q }

/** draws an attachment at `handle` and the cable from the wheel to its eye; returns the cable socket and grips */
export function hangAttachment(
  kit: Kit,
  wheel: Vector3,
  handle: HandlePose,
  o: { attachment: AttachmentKind | null; spec?: ImplementSpec; plane: (eye: Vector3) => Vector3; wrap: 'cw' | 'ccw' },
) {
  const pos = vec(handle.pos)
  let rot = handle.rot ? (handle.rot instanceof Quaternion ? handle.rot.clone() : new Quaternion(...handle.rot)) : hangingRotation(wheel.clone().sub(pos))
  const eyeOf = (q: Quaternion) => ATTACHMENT_EYE.clone().applyQuaternion(q).add(pos)
  let eye = eyeOf(rot)
  let exit = cableExit(wheel, WHEEL_R, eye, o.plane(eye), o.wrap)
  if (!handle.rot) {
    // hang along the cable itself (two passes settle it)
    for (let i = 0; i < 2; i++) {
      rot = hangingRotation(exit.exit.clone().sub(pos))
      eye = eyeOf(rot)
      exit = cableExit(wheel, WHEEL_R, eye, o.plane(eye), o.wrap)
    }
  }
  cableRun(kit, [exit.exit, eye])
  const m = poseMatrix(pos, rot)
  let grips: Record<string, GripSocket> = {}
  if (o.attachment) {
    const a = buildAttachment(o.attachment, o.spec)
    kit.merge(a, m)
    grips = Object.fromEntries(
      Object.entries(a.sockets.grips).map(([k, g]) => [k, { position: g.position.clone().applyMatrix4(m), axis: g.axis.clone().transformDirection(m) }]),
    )
  }
  const cable: CableSocket = { pulley: wheel.clone(), exit: exit.exit, direction: exit.direction }
  return { cable, grips, eye, handleMatrix: m }
}

export type CableStackParams = {
  /** wheel centre height: low 0.1, mid 1.0, high 2.0 (the lateral raise template's heights) or metres */
  pulley?: 'low' | 'mid' | 'high' | number
  /** attachment clipped to the cable (null: cable only, e.g. when the attachment is drawn in the hand) */
  attachment?: AttachmentKind | null
  /** descriptor to draw the attachment from (e.g. a template's widened rope) */
  attachmentSpec?: ImplementSpec
  /** attachment origin (carabiner) pose in the stack frame */
  handle?: HandlePose
  /** lift of the selected plates (m) */
  stackLift?: number
}

export const PULLEY_HEIGHTS = { low: 0.1, mid: 1.0, high: 2.0 }

export const CABLE_STACK = {
  /** wheel centre in front of the column axis, as the templates' pulley-to-column offset (0.12) */
  pulleyZ: 0.12,
  track: [0.08, 0.1] as [number, number],
  trackTop: 2.24,
  stackZ: -0.24,
  postX: 0.2,
  topWheelY: 2.29,
}

export type CableStackSockets = {
  cable: CableSocket
  grips: Record<string, GripSocket>
  /** attachment eye, where the cable ends */
  eye: Vector3
  /** wheel centre for a given height */
  pulleyAt: (height: number) => Vector3
}

export function pulleyHeight(p: CableStackParams['pulley']) {
  return typeof p === 'number' ? p : PULLEY_HEIGHTS[p ?? 'low']
}

/** Single-column cable stack. Frame: X across, Y up, the pulley faces +Z; column axis at x = 0, z = 0. */
export function buildCableStack(p: CableStackParams = {}): PropBuild<CableStackSockets> {
  const kit = new Kit()
  const h = pulleyHeight(p.pulley)
  const { pulleyZ, track, trackTop, stackZ, postX, topWheelY } = CABLE_STACK
  const R = WHEEL_R
  const [tw, td] = track
  const wheelAt = (y: number) => new Vector3(0, y, pulleyZ)
  const C = wheelAt(h)
  const cy = h + 0.16

  // base
  for (const s of [-1, 1]) {
    kit.tube([s * 0.26, 0.022, stackZ - 0.13], [s * 0.26, 0.022, 0.26], 0.06, 0.045, 'frame', { side: [1, 0, 0], cap: 'both' })
    foot(kit, [s * 0.26, 0, stackZ - 0.1], 0.07, 0.06)
    foot(kit, [s * 0.26, 0, 0.23], 0.07, 0.06)
  }
  for (const z of [stackZ, 0]) kit.tube([-0.23, 0.022, z], [0.23, 0.022, z], 0.06, 0.045, 'frame', { side: [0, 0, 1] })
  kit.box([0, 0.048, stackZ], [0.34, 0.008, 0.18], 'frameDark', undefined, 0.003)

  // column (adjustment track) with holes, stack posts, head with the top pulleys
  kit.tube([0, 0.045, 0], [0, trackTop, 0], tw, td, 'frame', { cap: 'b' })
  holeRow(kit, 0, td / 2, [0, 0, 1], 0.26, trackTop - 0.1, 0.06, 0.007)
  for (const s of [-1, 1]) {
    kit.tube([s * postX, 0.045, stackZ], [s * postX, topWheelY + 0.065, stackZ], 0.06, 0.06, 'frame')
    holeRow(kit, s * tw / 2, 0, [s, 0, 0], 0.26, trackTop - 0.1, 0.06, 0.006)
  }
  kit.tube([-postX + 0.03, 2.2, stackZ], [postX - 0.03, 2.2, stackZ], 0.05, 0.05, 'frame', { side: [0, 0, 1] })
  kit.tube([-postX - 0.03, topWheelY + 0.1, stackZ], [postX + 0.03, topWheelY + 0.1, stackZ], 0.07, 0.07, 'frame', { side: [0, 0, 1], cap: 'both' })
  kit.tube([0, topWheelY + 0.1, stackZ - 0.06], [0, topWheelY + 0.1, td / 2 + 0.06], 0.08, 0.07, 'frame', { side: [1, 0, 0], cap: 'both' })
  const A = new Vector3(0, topWheelY, stackZ + R), B = new Vector3(0, topWheelY, td / 2 + 0.025 - R)
  pulley(kit, A, [1, 0, 0])
  pulley(kit, B, [1, 0, 0])
  kit.box([0, topWheelY + 0.055, A.z], [0.05, 0.02, 0.05], 'frame', undefined, 0.004)
  kit.box([0, topWheelY + 0.055, B.z], [0.05, 0.02, 0.05], 'frame', undefined, 0.004)

  const stackTop = weightStack(kit, [0, 0, stackZ], { top: 2.2 - 0.025, lift: p.stackLift })

  // carriage on the column, swivel pulley housing below it
  kit.box([0, cy, 0], [tw + 0.04, 0.13, td + 0.04], 'frameDark', undefined, 0.014)
  kit.knob([tw / 2 + 0.02, cy + 0.02, 0], [1, 0, 0], 0.016)
  kit.tube([0, cy - 0.045, td / 2 + 0.02], [0, cy - 0.045, pulleyZ + 0.012], 0.04, 0.03, 'frameDark', { side: [1, 0, 0] })
  kit.rod([0, cy - 0.03, pulleyZ], [0, h + R + 0.022, pulleyZ], 0.014, 'steel', 20)

  const handle = p.handle ?? { pos: C.clone().add(new Vector3(0, h > 1.2 ? -0.35 : 0.3, 0.3)) }
  const plane = (eye: Vector3) => horizontalTowards(C, eye)
  const hung = hangAttachment(kit, C, handle, { attachment: p.attachment === undefined ? 'single_handle' : p.attachment, spec: p.attachmentSpec, plane, wrap: 'ccw' })
  const hdir = plane(hung.eye)
  const axle = new Vector3().crossVectors(hdir, new Vector3(0, 1, 0))
  pulley(kit, C, axle)
  const entry = C.clone().addScaledVector(hdir, -R)

  // cable: stack -> over the head -> down the column front -> carriage -> housing wheel -> attachment
  cableRun(kit, [stackTop, new Vector3(0, topWheelY, stackZ)])
  cableRun(kit, [new Vector3(0, topWheelY + R, A.z), new Vector3(0, topWheelY + R, B.z)])
  cableRun(kit, [new Vector3(0, topWheelY, B.z + R), new Vector3(0, cy + 0.065, B.z + R)])
  cableRun(kit, [entry.clone().setY(cy - 0.02), entry])

  return finish(kit, { cable: hung.cable, grips: hung.grips, eye: hung.eye, pulleyAt: wheelAt })
}


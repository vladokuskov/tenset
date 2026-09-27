import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Baked } from '../../../motion/bake.ts'
import type { Attachment, ImplementSpec, Part } from '../../../motion/implements.ts'
import type { Quat, V3 } from '../../../motion/math.ts'
import type { ImplementPose } from '../../../motion/skeleton.ts'
import { buildBarbell } from './barbell.ts'
import { buildCableStack } from './cable.ts'
import { Kit, type Piece } from './kit.ts'
import { buildLegPress, legPressDefaults } from './legpress.ts'
import { buildLatPulldown } from './pulldown.ts'
import { buildAssistedPullup, buildPullupStation, drawBar } from './pullup.ts'
import { buildSmith } from './smith.ts'
import { BENCH, benchDefaults, benchSockets, type BenchParams } from './sockets.ts'

// Collision descriptors for the drawn machines (frames, rails, stacks, plates, pads), for the motion QA penetration
// gate: plain boxes and cylinders (src/motion Part) in each machine's own frame, plus the pose that places that frame,
// laid out as the scene composer (motion/compose.ts motionProps) lays the machines out. Held implements (bars,
// attachments, the pull-up bar) are left out: the gate already checks them as the template's implements.

export type ColliderKind = 'frame' | 'rail' | 'stack' | 'plate' | 'pad'

/** a collision primitive in a machine's frame; `pad` parts are padded supports (seats, pads, foot plates) */
export type Collider = Part & { kind: ColliderKind }

export type Poses = ReadonlyMap<string, ImplementPose>

export type MachineColliders = {
  /** the composer's prop key */
  key: string
  /** implements of this machine the hands hold: a holding hand may close round its handles */
  holds: string[]
  at: (poses: Poses) => { pose: ImplementPose; colliders: Collider[] }
}

/** the machine as drawn (all pieces, in its frame) and the matrix placing it, as the composer builds it each frame */
export type MachineLayout = {
  key: string
  holds: string[]
  /** the same pieces at every frame */
  fixed: boolean
  build: (poses: Poses) => { placement: Matrix4; pieces: Piece[] }
  /** the pieces that collide: without held implements and attachments */
  solid: (poses: Poses) => { placement: Matrix4; pieces: Piece[] }
}

type Cyl = Extract<Part, { shape: 'cylinder' }>
type Box = Extract<Part, { shape: 'box' }>

const V = (v: readonly number[]) => new Vector3(v[0], v[1], v[2])
const m4 = (pos: readonly number[], rot?: readonly number[]) =>
  new Matrix4().compose(V(pos), rot ? new Quaternion(rot[0], rot[1], rot[2], rot[3]) : new Quaternion(), new Vector3(1, 1, 1))
const v3 = (v: Vector3): V3 => [v.x, v.y, v.z]
const quat = (q: Quaternion): Quat => [q.x, q.y, q.z, q.w]

const KIND: Partial<Record<Piece['mat'], ColliderKind>> = {
  frame: 'frame',
  frameDark: 'frame',
  rubber: 'frame',
  pulley: 'frame',
  pad: 'pad',
  stack: 'stack',
  plate: 'plate',
  plateFace: 'plate',
  steel: 'rail',
  steelDark: 'rail',
  grip: 'rail',
  handle: 'rail',
  rope: 'rail',
}

const Y = new Vector3(0, 1, 0)
const Z = new Vector3(0, 0, 1)

/**
 * Collision primitives for kit pieces (in the pieces' frame). Cylinders, knurls, plates and wheels become cylinders,
 * tubes and rounded boxes boxes, spheres and rings spheres and discs. Cables and adjustment holes are skipped; a
 * wide flat rubber face (a foot plate, a step tread) is a padded support.
 */
export function pieceColliders(pieces: Piece[]): Collider[] {
  const out: Collider[] = []
  const pos = new Vector3(), rot = new Quaternion(), scl = new Vector3()
  for (const p of pieces) {
    const kind = KIND[p.mat]
    if (!kind) continue
    p.matrix.decompose(pos, rot, scl)
    const [geo, ...rest] = p.geo.split(':')
    const n = rest.map(Number)
    const push = (part: Part, k: ColliderKind = kind) => out.push({ ...part, kind: k, ...(k === 'pad' ? { pad: true } : {}) })
    const along = (dir: Vector3, from: number, to: number, r: number) =>
      push({ shape: 'cylinder', a: v3(pos.clone().addScaledVector(dir, from)), b: v3(pos.clone().addScaledVector(dir, to)), r })
    const axis = Y.clone().applyQuaternion(rot)
    const box = (size: V3) => {
      const flat = p.mat === 'rubber' && [...size].sort((x, y) => y - x)[1] >= 0.2
      push({ shape: 'box', center: v3(pos), size, rot: quat(rot) }, flat ? 'pad' : kind)
    }
    switch (geo) {
      case 'cyl':
        along(axis, -scl.y / 2, scl.y / 2, scl.x)
        break
      case 'knurl':
        along(axis, -n[1] / 2, n[1] / 2, n[0])
        break
      case 'plate':
      case 'wheel':
        along(axis, 0, n[1], n[0])
        break
      case 'lathe': {
        const pts = JSON.parse(decodeURIComponent(rest.join(':'))) as [number, number][]
        along(axis, Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])))
        break
      }
      case 'sphere':
        along(axis, 0, 0, Math.max(scl.x, scl.y, scl.z))
        break
      case 'torus':
        along(Z.clone().applyQuaternion(rot), -n[1], n[1], n[0] + n[1])
        break
      case 'tube':
        box([n[0], scl.y, n[1]])
        break
      case 'rbox':
        box([n[0], n[1], n[2]])
        break
    }
  }
  return out
}

// ---------- layout (mirrors compose.ts motionProps; collision.test.ts checks they agree piece for piece) ----------

function liftRange(b: Baked, id: string, from: Vector3) {
  const k = b.implements.findIndex((i) => i.id === id)
  let min = Infinity
  for (let i = 0; i < b.frames; i++) {
    const o = (i * b.implements.length + k) * 7
    min = Math.min(min, from.distanceTo(new Vector3(b.ip[o], b.ip[o + 1], b.ip[o + 2])))
  }
  return min
}

const ATTACHMENTS = new Set<Attachment>(['rope', 'straight_bar', 'ez_bar', 'v_bar', 'single_handle', 'long_bar', 'ankle_strap'])

function attachmentKind(params: Record<string, unknown>, fallback: Attachment): Attachment {
  const a = params.attachment as Attachment | undefined
  return a && ATTACHMENTS.has(a) ? a : fallback
}

function pulleyOf(station: ImplementSpec): Vector3 {
  let best: Vector3 | null = null
  for (const p of station.parts) {
    if (p.shape !== 'cylinder' || Math.abs(p.a[0] - p.b[0]) + Math.abs(p.a[2] - p.b[2]) > 1e-6) continue
    const lo = p.a[1] < p.b[1] ? p.a : p.b, hi = p.a[1] < p.b[1] ? p.b : p.a
    if (hi[1] > 2 && lo[1] > 2 && (!best || lo[1] < best.y)) best = V(lo)
  }
  if (!best) throw new Error('station has no pulley drop')
  return best
}

/** pieces drawBar adds first: the pull-up bar and its parallel handles (the held implement) */
function barPieces(spec: ImplementSpec, height: number) {
  const kit = new Kit()
  drawBar(kit, spec, new Vector3(0, height, 0))
  return kit.pieces.length
}

/** the drawn machines of a baked motion, as motion/compose.ts motionProps draws them */
export function machineLayouts(b: Baked): MachineLayout[] {
  const params = b.params
  const specs = new Map(b.implements.map((s) => [s.id, s]))
  const first = new Map(b.implements.map((s, k) => [s.id, { pos: [b.ip[k * 7], b.ip[k * 7 + 1], b.ip[k * 7 + 2]], rot: [b.ip[k * 7 + 3], b.ip[k * 7 + 4], b.ip[k * 7 + 5], b.ip[k * 7 + 6]] }]))
  const out: MachineLayout[] = []
  const handle = [...specs.values()].find((s) => s.kind === 'cable_handle')

  for (const spec of b.implements) {
    if (spec.kind !== 'pullup_bar' || specs.has('pad')) continue
    const pose = first.get(spec.id)!
    const placement = m4([pose.pos[0], 0, pose.pos[2]])
    const pieces = buildPullupStation({ spec, height: pose.pos[1] }).pieces
    const skip = barPieces(spec, pose.pos[1])
    out.push({ key: spec.id, holds: [spec.id], fixed: true, build: () => ({ placement, pieces }), solid: () => ({ placement, pieces: pieces.slice(skip) }) })
  }

  if (specs.has('smith')) {
    const bar = specs.get('bar')!
    const gripWidth = Math.abs(bar.sites.l.pos[0] - bar.sites.r.pos[0])
    const plates = Math.round((bar.mass - 20) / 2 / 20)
    const barCount = buildBarbell({ gripWidth, plates }).pieces.length
    const build = (poses: Poses) => {
      const p = poses.get('bar')!.pos
      return { placement: m4([p[0], 0, p[2]]), pieces: buildSmith({ barHeight: p[1], gripWidth, plates }).pieces }
    }
    out.push({
      key: 'smith',
      holds: ['bar'],
      fixed: false,
      build,
      solid: (poses) => {
        const r = build(poses)
        return { ...r, pieces: r.pieces.slice(0, r.pieces.length - barCount) }
      },
    })
  }

  if (specs.has('press')) {
    const hip = legPressDefaults.hip
    const a = (Number(params.sledAngle ?? 45) * Math.PI) / 180
    const d = new Vector3(0, Math.sin(a), Math.cos(a))
    const hs = specs.get('handles')?.sites
    const handles = hs && { l: { pos: hs.l.pos, axis: hs.l.axis! }, r: { pos: hs.r.pos, axis: hs.r.axis! } }
    const build = (poses: Poses) => {
      const sled = V(poses.get('sled')!.pos).sub(V(hip)).dot(d)
      return { placement: new Matrix4(), pieces: buildLegPress({ sledAngle: (a * 180) / Math.PI, sled, hip, handles }).pieces }
    }
    out.push({ key: 'leg-press', holds: ['handles'], fixed: false, build, solid: build })
  }

  const stack = specs.get('stack')
  if (stack && handle && b.cables?.length) {
    const pulley = V(b.cables[0].pulley)
    const column = V((stack.parts[0] as Cyl).a).setY(0)
    const facing = pulley.clone().sub(column).setY(0).normalize()
    const placement = new Matrix4().makeRotationY(Math.atan2(facing.x, facing.z)).setPosition(column)
    const inv = placement.clone().invert()
    const kind = attachmentKind(params, 'single_handle')
    const min = liftRange(b, handle.id, pulley)
    const make = (attachment: Attachment | null) => (poses: Poses) => {
      const hp = poses.get(handle.id)!
      const local = m4(hp.pos, hp.rot).premultiply(inv)
      const pos = new Vector3(), rot = new Quaternion()
      local.decompose(pos, rot, new Vector3())
      const lift = Math.max(0, pulley.distanceTo(V(hp.pos)) - min)
      return { placement, pieces: buildCableStack({ pulley: pulley.y, attachment, attachmentSpec: handle, handle: { pos, rot }, stackLift: lift }).pieces }
    }
    out.push({ key: 'cable-stack', holds: [handle.id], fixed: false, build: make(kind), solid: make(null) })
  }

  const station = specs.get('station')
  if (station && handle) {
    const seat = station.parts.find((p) => p.shape === 'box' && p.pad) as Box
    const roller = station.parts.find((p) => p.shape === 'cylinder' && p.pad) as Cyl
    const pad: V3 = [0, (roller.a[1] + roller.b[1]) / 2, (roller.a[2] + roller.b[2]) / 2]
    const pulley = pulleyOf(station)
    const kind = attachmentKind(params, 'long_bar')
    const min = liftRange(b, handle.id, pulley)
    const make = (attachment: Attachment | null) => (poses: Poses) => {
      const hp = poses.get(handle.id)!
      const lift = Math.max(0, pulley.distanceTo(V(hp.pos)) - min)
      const pieces = buildLatPulldown({
        seatHeight: seat.center[1] + seat.size[1] / 2,
        pad,
        pulley: v3(pulley),
        attachment,
        attachmentSpec: handle,
        handle: { pos: hp.pos, rot: hp.rot },
        stackLift: lift,
      }).pieces
      return { placement: new Matrix4(), pieces }
    }
    out.push({ key: 'lat-pulldown', holds: [handle.id], fixed: false, build: make(kind), solid: make(null) })
  }

  if (specs.has('pad') && specs.has('pullup')) {
    const bar = specs.get('pullup')!
    const barPose = first.get('pullup')!
    const k = b.implements.findIndex((i) => i.id === 'pad')
    let low = Infinity
    for (let i = 0; i < b.frames; i++) low = Math.min(low, b.ip[(i * b.implements.length + k) * 7 + 1])
    const at = new Vector3(barPose.pos[0], 0, barPose.pos[2])
    const skip = barPieces(bar, barPose.pos[1])
    const build = (poses: Poses) => {
      const p = poses.get('pad')!.pos
      const pieces = buildAssistedPullup({ spec: bar, height: barPose.pos[1], pad: [p[0] - at.x, p[1], p[2] - at.z], stackLift: p[1] - low }).pieces
      return { placement: m4(v3(at)), pieces }
    }
    out.push({
      key: 'assisted-pullup',
      holds: ['pullup'],
      fixed: false,
      build,
      solid: (poses) => {
        const r = build(poses)
        return { ...r, pieces: r.pieces.slice(skip) }
      },
    })
  }

  return out
}

/** adjustable bench under a template's seated bench: seat top and back pad surface on the template's (compose.ts benchLayout) */
export function benchLayout(spec: ImplementSpec, pose: { pos: readonly number[] }): { params: BenchParams; position: V3 } {
  const pad = spec.parts.find((p) => p.shape === 'box' && p.rot) as Box
  const a = 2 * Math.atan2(pad.rot![0], pad.rot![3])
  const h = pose.pos[1]
  const z = pose.pos[2] + BENCH.seat.len / 2 + (BENCH.back.thick * (Math.cos(a) - 1)) / Math.sin(a)
  return { params: { back: (a * 180) / Math.PI, height: h }, position: [pose.pos[0], 0, z] }
}

/** the adjustable bench (Bench.tsx) as boxes in its own frame */
export function benchColliders(p: BenchParams = {}): Collider[] {
  const o = { ...benchDefaults, ...p }
  const s = benchSockets(o)
  const { seat: SEAT, back: BACK, railY, frontZ, rearZ } = BENCH
  const out: Collider[] = []
  const tube = (from: Vector3, to: Vector3, w: number, h: number) => {
    const rot = new Quaternion().setFromUnitVectors(Y, to.clone().sub(from).normalize())
    out.push({ shape: 'box', center: v3(from.clone().lerp(to, 0.5)), size: [w, from.distanceTo(to), h], rot: quat(rot), kind: 'frame' })
  }
  const rotX = (a: number) => quat(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), a))
  const b = (o.back * Math.PI) / 180
  const tilt = (o.seat * Math.PI) / 180
  const { hinge } = s
  const { along, normal } = s.back
  for (const z of [frontZ, rearZ]) {
    tube(new Vector3(-0.24, 0.035, z), new Vector3(0.24, 0.035, z), 0.07, 0.05)
    for (const x of [-1, 1]) out.push({ shape: 'box', center: [x * 0.25, 0.017, z], size: [0.07, 0.035, 0.06], kind: 'frame' })
  }
  const railFront = new Vector3(0, railY, frontZ - 0.04)
  const railRear = new Vector3(0, railY, rearZ + 0.04)
  const strutTop = hinge.clone().addScaledVector(along, Math.min(0.5, 0.18 + 0.3 * Math.max(0, Math.sin(b)))).addScaledVector(normal, -0.03)
  const strutFoot = new Vector3(0, railY + 0.03, Math.max(rearZ + 0.12, strutTop.z - 0.22 * Math.cos(b) - 0.05))
  tube(new Vector3(0, 0.05, frontZ), railFront, 0.07, 0.05)
  tube(new Vector3(0, 0.05, rearZ), railRear, 0.07, 0.05)
  tube(railFront, railRear, 0.08, 0.06)
  tube(new Vector3(0, railY, 0.04), new Vector3(0, o.height - SEAT.thick - 0.03, 0.02), 0.07, 0.05)
  tube(strutFoot, strutTop, 0.06, 0.045)
  const pin = strutFoot.clone().add(new Vector3(0, 0.02, 0))
  out.push({ shape: 'cylinder', a: [pin.x - 0.045, pin.y, pin.z], b: [pin.x + 0.045, pin.y, pin.z], r: 0.012, kind: 'rail' })
  const seatC = new Vector3(0, o.height - SEAT.thick / 2, 0)
  const seatRot = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -tilt)
  out.push({ shape: 'box', center: v3(seatC), size: [SEAT.width, SEAT.thick, SEAT.len], rot: quat(seatRot), kind: 'pad', pad: true })
  const board = seatC.clone().add(new Vector3(0, -SEAT.thick / 2 - 0.006, 0).applyQuaternion(seatRot))
  out.push({ shape: 'box', center: v3(board), size: [SEAT.width - 0.04, 0.012, SEAT.len - 0.04], rot: quat(seatRot), kind: 'frame' })
  const backC = hinge.clone().addScaledVector(along, BACK.len / 2 + 0.01).addScaledVector(normal, BACK.thick / 2)
  const backBoard = hinge.clone().addScaledVector(along, BACK.len / 2 + 0.01).addScaledVector(normal, -0.012)
  out.push({ shape: 'box', center: v3(backC), size: [BACK.width, BACK.thick, BACK.len], rot: rotX(b), kind: 'pad', pad: true })
  out.push({ shape: 'box', center: v3(backBoard), size: [BACK.width - 0.05, 0.012, BACK.len - 0.06], rot: rotX(b), kind: 'frame' })
  return out
}

const poseOf = (m: Matrix4): ImplementPose => {
  const pos = new Vector3(), rot = new Quaternion()
  m.decompose(pos, rot, new Vector3())
  return { id: '', pos: v3(pos), rot: quat(rot) }
}

/** collision primitives of every drawn machine and seated bench in a baked motion, per frame */
export function machineColliders(b: Baked): MachineColliders[] {
  const out: MachineColliders[] = machineLayouts(b).map((l) => {
    let cached: { pose: ImplementPose; colliders: Collider[] } | null = null
    const at = (poses: Poses) => {
      if (cached) return cached
      const { placement, pieces } = l.solid(poses)
      const r = { pose: { ...poseOf(placement), id: l.key }, colliders: pieceColliders(pieces) }
      if (l.fixed) cached = r
      return r
    }
    return { key: l.key, holds: l.holds, at }
  })
  const bench = b.implements.find((s) => s.id === 'bench')
  if (bench && bench.parts.some((p) => p.shape === 'box' && !p.rot)) {
    const k = b.implements.indexOf(bench)
    const { params, position } = benchLayout(bench, { pos: [b.ip[k * 7], b.ip[k * 7 + 1], b.ip[k * 7 + 2]] })
    const r = { pose: { id: 'bench', pos: position, rot: [0, 0, 0, 1] as Quat }, colliders: benchColliders(params) }
    out.push({ key: 'bench', holds: [], at: () => r })
  }
  return out
}

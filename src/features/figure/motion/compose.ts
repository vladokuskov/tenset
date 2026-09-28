import { Matrix4, Quaternion, Vector3 } from 'three'
import { decode, sampler, type Baked, type CompactMotion } from '../../../motion/bake.ts'
import { bodyCapsules } from '../../../motion/collide.ts'
import { fk } from '../../../motion/fk.ts'
import type { ImplementSpec, Part } from '../../../motion/implements.ts'
import { MOVING_KINDS } from '../../../motion/implements/index.ts'
import { boneRotations, boneWorld } from '../../../motion/retarget.ts'
import type { ImplementPose, Pose, Skeleton } from '../../../motion/skeleton.ts'
import { phaseAt } from '../../../motion/timing.ts'
import { computeGripAt, isWrapGrip, solveGrip, type GripName, type GripSolution, type HandSide } from '../hands'
import type { FigureHighlight } from '../highlight'
import { buildBarbell, buildEzBar } from '../props/barbell'
import { buildCableStack, type AttachmentKind } from '../props/cable'
import { benchColliders, benchLayout, pieceColliders, type Collider } from '../props/collision.ts'
import { extensionLayouts } from '../props/extensions.ts'
import { Kit, type Piece } from '../props/kit'
import { buildLegPress, legPressDefaults } from '../props/legpress'
import { buildLatPulldown } from '../props/pulldown'
import { buildAssistedPullup, buildPullupStation } from '../props/pullup'
import { buildSmith } from '../props/smith'
import { DUMBBELL_COLLAR, type BenchParams, type DumbbellParams } from '../props/sockets'
import { fixtureParts } from './fixtures'
import { sceneFor, type CameraPreset, type MotionExercise } from './scenes/index.ts'

// Scene composer: exercise record + baked loop -> highlight, hero camera, finger grips, props laid out on the
// template's implements, and the points the camera frames. Pure (three math only), so it runs in tests.
// Per-template specifics (camera, grips, highlight, extra equipment) live in scenes/<template>.ts, family props in
// props/families/<family>.ts (docs/FAMILIES.md).

export type { CameraPreset, MotionExercise } from './scenes/index.ts'

export type ViewPreset = 'front' | 'side' | 'back' | 'hero'

export const viewPresets: Record<Exclude<ViewPreset, 'hero'>, CameraPreset> = {
  front: { az: 0, elev: 0.14 },
  side: { az: -90, elev: 0.14 },
  back: { az: 180, elev: 0.14 },
}

export type Poses = ReadonlyMap<string, ImplementPose>

export type PropSpec =
  /** fixed pieces, world space or (attach) in an implement's frame; `whole`: framed base to top */
  | { type: 'rigid'; key: string; pieces: Piece[]; attach?: string; whole?: boolean }
  /** rebuilt every frame from the implement poses (machines with moving parts, cables) */
  | { type: 'dynamic'; key: string; build: (poses: Poses) => Piece[]; whole?: boolean }
  | { type: 'dumbbell'; key: string; attach: string; params: DumbbellParams }
  | { type: 'bench'; key: string; params: BenchParams; position: [number, number, number] }

export type HandGrip = { side: HandSide; solution: GripSolution }

export type MotionScene = {
  baked: Baked
  template: string
  params: Record<string, unknown>
  /** pose at loop fraction u */
  poseAt: (u: number) => Pose
  /** concentric pulse phase 0..1 at loop fraction u, null outside the concentric */
  pulseAt: (u: number) => number | null
  /** loop fraction of the middle of the concentric (reduced motion rests here) */
  midRep: number
  highlight: FigureHighlight
  hero: CameraPreset
  grips: HandGrip[]
  props: PropSpec[]
  /** flat xyz world points the camera keeps in frame (body over the loop, held implements, supports) */
  frame: number[]
  /** half size of the floor square (around the origin) the contact shadow must cover */
  floor: number
}

// ---------- camera ----------

/** exercise-illustration camera per template (scenes/<template>.ts): curls front 3/4, raises front, pulls back 3/4,
 * squats rear 3/4 (glutes and quads), leg press behind the shoulder; pending templates by mapView */
export function heroCamera(template: string, params: Record<string, unknown>, mapView: 'F' | 'B'): CameraPreset {
  return sceneFor(template).camera(params, mapView)
}

// ---------- highlight and pulse ----------

export function motionHighlight(ex: MotionExercise, params: Record<string, unknown>, template?: string): FigureHighlight {
  const primary = Object.keys(ex.groups).filter((g) => ex.groups[g] === 'primary')
  const secondary = Object.keys(ex.groups).filter((g) => ex.groups[g] === 'secondary')
  const side = ex.laterality === 'unilateral' ? (params.side === 'left' ? 'l' : 'r') : undefined
  const base: FigureHighlight = { primary, secondary, ...(side ? { side } : {}) }
  const adjust = template ? sceneFor(template).highlight : undefined
  return adjust ? adjust(base, ex, params) : base
}

function midConcentric(b: Baked) {
  const [ecc, pb, con, pt] = b.tempo
  return (pt / 2 + ecc + pb + con / 2) / (ecc + pb + con + pt)
}

// ---------- grips ----------

type Cyl = Extract<Part, { shape: 'cylinder' }>

const V = (v: readonly number[]) => new Vector3(v[0], v[1], v[2])

/** radius of the implement cylinder nearest a site (the handle the hand closes on) */
function handleRadius(spec: ImplementSpec, site: string): number {
  const p = V(spec.sites[site].pos)
  let best = Infinity, r = 0.016
  for (const part of spec.parts) {
    if (part.shape !== 'cylinder') continue
    const a = V(part.a), b = V(part.b)
    const ab = b.clone().sub(a)
    const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-12)))
    const d = a.addScaledVector(ab, t).distanceTo(p)
    if (d < best) [best, r] = [d, (part as Cyl).r]
  }
  return r
}

function wrapStyle(params: Record<string, unknown>, spec: ImplementSpec, fingertips: boolean, site: string): GripName {
  // front rack: the bar lies across the fingers, thumb tucked under it
  if (fingertips) return 'hook'
  // goblet: palms cupped under the top head
  if (site.startsWith('cup_')) return 'goblet'
  if (spec.kind === 'cable_handle' && params.attachment === 'rope') return 'rope'
  if (spec.kind === 'cable_handle' && (params.attachment ?? 'single_handle') === 'single_handle') return 'd-handle'
  if (spec.kind === 'bench') return 'neutral'
  const g = params.grip
  return g === 'supinated' || g === 'neutral' ? g : 'pronated'
}

const FRAME_SAMPLES = 16

type Hold = { k: number; point: Vector3; axis: Vector3; diameter: number; style: GripName }

/** what a hand closes on: the handle of its grip contact */
function holdFor(b: Baked, params: Record<string, unknown>, s: 'l' | 'r'): Hold | null {
  const contact = b.contacts.find((c) => (c.site === `grip_${s}` || c.site === `fingers_${s}`) && 'implement' in c.target)
  if (!contact || !('implement' in contact.target)) return null
  const { implement, grip } = contact.target
  const k = b.implements.findIndex((i) => i.id === implement)
  const spec = b.implements[k]
  const site = spec.sites[grip]
  const fingertips = contact.site.startsWith('fingers_')
  const style = sceneFor(b.template).grip?.({ params, spec, site: grip, side: s, fingertips }) ?? wrapStyle(params, spec, fingertips, grip)
  return { k, point: V(site.pos), axis: V(site.axis ?? [1, 0, 0]), diameter: 2 * handleRadius(spec, grip), style }
}

/**
 * Finger grips for both hands. A hand that holds an implement closes on it where the motion holds it: the handle
 * centre and axis are measured in the wrist bone frame over the loop (contacts hold them within millimetres) and the
 * wrap is solved there. Free hands take the relaxed pose.
 */
export function motionGrips(b: Baked, skel: Skeleton, params: Record<string, unknown>): HandGrip[] {
  const out: HandGrip[] = []
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 'l' : 'r'
    const hold = holdFor(b, params, s)
    // posed shapes (a cupped palm) rest against the implement instead of closing round a handle
    if (!hold || !isWrapGrip(hold.style)) {
      out.push({ side, solution: solveGrip(hold?.style ?? 'relaxed') })
      continue
    }
    const center = new Vector3(), axis = new Vector3()
    const handAxis = V(skel.data.sites[`grip_${s}`].axis!)
    for (let n = 0; n < FRAME_SAMPLES; n++) {
      const i = Math.floor((n * b.frames) / FRAME_SAMPLES)
      const f = fk(skel, b.q.subarray(i * b.nDof, (i + 1) * b.nDof))
      const wrist = boneWorld(skel, boneRotations(skel, f)).get(`wrist_${side}`)!
      const inv = new Quaternion(...wrist.rot).invert()
      const o = (i * b.implements.length + hold.k) * 7
      const rot = new Quaternion(b.ip[o + 3], b.ip[o + 4], b.ip[o + 5], b.ip[o + 6])
      const p = hold.point.clone().applyQuaternion(rot).add(new Vector3(b.ip[o], b.ip[o + 1], b.ip[o + 2]))
      center.add(p.sub(V(wrist.head)).applyQuaternion(inv))
      const a = hold.axis.clone().applyQuaternion(rot).applyQuaternion(inv)
      // the hand's pinky -> index direction, in the same wrist frame
      const hand = handAxis.clone().applyQuaternion(new Quaternion(...f.rot[skel.seg[`hand_${s}`]])).applyQuaternion(inv)
      axis.add(a.dot(hand) < 0 ? a.negate() : a)
    }
    center.divideScalar(FRAME_SAMPLES)
    axis.normalize()
    // the solver models the left hand; the right is its mirror image
    if (side === 'R') {
      center.x = -center.x
      axis.x = -axis.x
    }
    out.push({ side, solution: computeGripAt(hold.style, hold.diameter, { center, axis }) })
  }
  return out
}

// ---------- props ----------

const m4 = (pos: readonly number[], rot?: readonly number[]) =>
  new Matrix4().compose(V(pos), rot ? new Quaternion(rot[0], rot[1], rot[2], rot[3]) : new Quaternion(), new Vector3(1, 1, 1))

const merged = (pieces: Piece[], m: Matrix4) => new Kit().merge({ pieces }, m).pieces

const ATTACHMENTS = new Set<AttachmentKind>(['rope', 'straight_bar', 'ez_bar', 'v_bar', 'single_handle', 'long_bar', 'ankle_strap'])

function attachmentKind(params: Record<string, unknown>, fallback: AttachmentKind): AttachmentKind {
  const a = params.attachment as AttachmentKind | undefined
  return a && ATTACHMENTS.has(a) ? a : fallback
}

/** cable length change over the loop, for the stack lift: distance from `from` to an implement's origin */
function liftRange(b: Baked, id: string, from: Vector3) {
  const k = b.implements.findIndex((i) => i.id === id)
  let min = Infinity
  for (let i = 0; i < b.frames; i++) {
    const o = (i * b.implements.length + k) * 7
    min = Math.min(min, from.distanceTo(new Vector3(b.ip[o], b.ip[o + 1], b.ip[o + 2])))
  }
  return min
}

function dumbbellParams(spec: ImplementSpec): DumbbellParams {
  const [handle, head] = spec.parts as Cyl[]
  return {
    handle: Math.abs(handle.b[0] - handle.a[0]) - 2 * DUMBBELL_COLLAR,
    handleRadius: handle.r,
    headRadius: head.r,
    headWidth: Math.abs(head.b[0] - head.a[0]),
  }
}

function pulleyOf(station: ImplementSpec): Vector3 {
  // the boom's drop to the pulley: the lowest end of a vertical cylinder that starts above 2 m
  let best: Vector3 | null = null
  for (const p of station.parts) {
    if (p.shape !== 'cylinder' || Math.abs(p.a[0] - p.b[0]) + Math.abs(p.a[2] - p.b[2]) > 1e-6) continue
    const lo = p.a[1] < p.b[1] ? p.a : p.b, hi = p.a[1] < p.b[1] ? p.b : p.a
    if (hi[1] > 2 && lo[1] > 2 && (!best || lo[1] < best.y)) best = V(lo)
  }
  if (!best) throw new Error('station has no pulley drop')
  return best
}

export function motionProps(b: Baked, params: Record<string, unknown>): PropSpec[] {
  const specs = new Map(b.implements.map((s) => [s.id, s]))
  const first = new Map(b.implements.map((s, k) => [s.id, { id: s.id, pos: [b.ip[k * 7], b.ip[k * 7 + 1], b.ip[k * 7 + 2]], rot: [b.ip[k * 7 + 3], b.ip[k * 7 + 4], b.ip[k * 7 + 5], b.ip[k * 7 + 6]] } as ImplementPose]))
  const out: PropSpec[] = []
  const smith = specs.has('smith')
  const handle = [...specs.values()].find((s) => s.kind === 'cable_handle')

  for (const spec of b.implements) {
    const pose = first.get(spec.id)!
    if (spec.kind === 'barbell' && !smith) out.push({ type: 'rigid', key: spec.id, pieces: buildBarbell({ spec }).pieces, attach: spec.id })
    else if (spec.kind === 'ez_bar') out.push({ type: 'rigid', key: spec.id, pieces: buildEzBar({ spec }).pieces, attach: spec.id })
    else if (spec.kind === 'dumbbell') out.push({ type: 'dumbbell', key: spec.id, attach: spec.id, params: dumbbellParams(spec) })
    else if (spec.kind === 'pullup_bar' && !specs.has('pad')) {
      out.push({ type: 'rigid', key: spec.id, pieces: merged(buildPullupStation({ spec, height: pose.pos[1] }).pieces, m4([pose.pos[0], 0, pose.pos[2]])) })
    }
  }

  if (smith) {
    const bar = specs.get('bar')!
    const gripWidth = Math.abs(bar.sites.l.pos[0] - bar.sites.r.pos[0])
    const plates = Math.round(((bar.mass - 20) / 2) / 20)
    out.push({
      type: 'dynamic',
      key: 'smith',
      build: (poses) => {
        const p = poses.get('bar')!.pos
        return merged(buildSmith({ barHeight: p[1], gripWidth, plates }).pieces, m4([p[0], 0, p[2]]))
      },
    })
  }

  if (specs.has('press')) {
    const hip = legPressDefaults.hip
    const a = (Number(params.sledAngle ?? 45) * Math.PI) / 180
    const d = new Vector3(0, Math.sin(a), Math.cos(a))
    const hs = specs.get('handles')?.sites
    const handles = hs && { l: { pos: hs.l.pos as [number, number, number], axis: hs.l.axis as [number, number, number] }, r: { pos: hs.r.pos as [number, number, number], axis: hs.r.axis as [number, number, number] } }
    out.push({
      type: 'dynamic',
      key: 'leg-press',
      build: (poses) => {
        const sled = V(poses.get('sled')!.pos).sub(V(hip)).dot(d)
        return buildLegPress({ sledAngle: (a * 180) / Math.PI, sled, hip, handles }).pieces
      },
    })
  }

  const stack = specs.get('stack')
  if (stack && handle && b.cables?.length) {
    const pulley = V(b.cables[0].pulley)
    const column = V((stack.parts[0] as Cyl).a).setY(0)
    const facing = pulley.clone().sub(column).setY(0).normalize()
    const m = new Matrix4().makeRotationY(Math.atan2(facing.x, facing.z)).setPosition(column)
    const inv = m.clone().invert()
    const kind = attachmentKind(params, 'single_handle')
    const min = liftRange(b, handle.id, pulley)
    out.push({
      type: 'dynamic',
      key: 'cable-stack',
      build: (poses) => {
        const hp = poses.get(handle.id)!
        const local = m4(hp.pos, hp.rot).premultiply(inv)
        const pos = new Vector3(), rot = new Quaternion()
        local.decompose(pos, rot, new Vector3())
        const lift = Math.max(0, pulley.distanceTo(V(hp.pos)) - min)
        return merged(buildCableStack({ pulley: pulley.y, attachment: kind, attachmentSpec: handle, handle: { pos, rot }, stackLift: lift }).pieces, m)
      },
    })
  }

  const station = specs.get('station')
  if (station && handle) {
    const seat = station.parts.find((p) => p.shape === 'box' && p.pad) as Extract<Part, { shape: 'box' }>
    const roller = station.parts.find((p) => p.shape === 'cylinder' && p.pad) as Cyl
    const pad: [number, number, number] = [0, (roller.a[1] + roller.b[1]) / 2, (roller.a[2] + roller.b[2]) / 2]
    const pulley = pulleyOf(station)
    const kind = attachmentKind(params, 'long_bar')
    const min = liftRange(b, handle.id, pulley)
    out.push({
      type: 'dynamic',
      key: 'lat-pulldown',
      build: (poses) => {
        const hp = poses.get(handle.id)!
        const lift = Math.max(0, pulley.distanceTo(V(hp.pos)) - min)
        return buildLatPulldown({
          seatHeight: seat.center[1] + seat.size[1] / 2,
          pad,
          pulley: pulley.toArray() as [number, number, number],
          attachment: kind,
          attachmentSpec: handle,
          handle: { pos: hp.pos, rot: hp.rot },
          stackLift: lift,
        }).pieces
      },
    })
  }

  if (specs.has('pad') && specs.has('pullup')) {
    const bar = specs.get('pullup')!
    const barPose = first.get('pullup')!
    let low = Infinity
    const k = b.implements.findIndex((i) => i.id === 'pad')
    for (let i = 0; i < b.frames; i++) low = Math.min(low, b.ip[(i * b.implements.length + k) * 7 + 1])
    out.push({
      type: 'dynamic',
      key: 'assisted-pullup',
      build: (poses) => {
        const p = poses.get('pad')!.pos
        const at = new Vector3(barPose.pos[0], 0, barPose.pos[2])
        return merged(buildAssistedPullup({ spec: bar, height: barPose.pos[1], pad: [p[0] - at.x, p[1], p[2] - at.z], stackLift: p[1] - low }).pieces, m4(at.toArray()))
      },
    })
  }

  const bench = specs.get('bench')
  if (bench) {
    const pose = first.get('bench')!
    const seated = bench.parts.some((p) => p.shape === 'box' && !p.rot)
    if (seated) out.push({ type: 'bench', key: 'bench', ...benchLayout(bench, pose) })
    else out.push({ type: 'rigid', key: 'bench', pieces: fixtureParts(bench.parts, m4(pose.pos, pose.rot)) })
  }

  const post = specs.get('post')
  if (post) out.push({ type: 'rigid', key: 'post', pieces: fixtureParts(post.parts, m4([0, 0, 0])) })

  // family props and the scene module's equipment (props/extensions.ts), the same layouts the QA gate collides with
  for (const l of extensionLayouts(b)) {
    const whole = l.whole ? { whole: true } : {}
    if (l.fixed) {
      const { placement, pieces } = l.build(first)
      out.push({ type: 'rigid', key: l.key, pieces: merged(pieces, placement), ...whole })
    } else {
      const build = (poses: Poses) => {
        const r = l.build(poses)
        return merged(r.pieces, r.placement)
      }
      out.push({ type: 'dynamic', key: l.key, build, ...whole })
    }
  }
  const keys = out.map((p) => p.key)
  const dup = keys.find((k, i) => keys.indexOf(k) !== i)
  if (dup) throw new Error(`${b.template}: two props share the key ${dup}`)
  return out
}

// ---------- framing ----------

/** implement parts the camera keeps in view: held implements, support pads, the pull-up bar, benches */
function framedParts(spec: ImplementSpec): Part[] {
  if (MOVING_KINDS.has(spec.kind) || spec.id === 'bench' || spec.id === 'sled') return spec.parts
  if (spec.kind === 'pullup_bar') return spec.parts.filter((p) => p.shape === 'cylinder' && Math.abs(p.a[1] - p.b[1]) < 0.05)
  return spec.parts.filter((p) => p.pad)
}

function partPoints(part: Part, m: Matrix4, out: number[]) {
  const push = (v: Vector3) => out.push(v.x, v.y, v.z)
  if (part.shape === 'cylinder') {
    for (const e of [part.a, part.b]) {
      const c = V(e).applyMatrix4(m)
      for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) push(c.clone().addScaledVector(V(d), part.r))
    }
  } else {
    const r = part.rot ? new Quaternion(...part.rot) : new Quaternion()
    for (let k = 0; k < 8; k++) {
      const c = new Vector3(((k & 1 ? 1 : -1) * part.size[0]) / 2, ((k & 2 ? 1 : -1) * part.size[1]) / 2, ((k & 4 ? 1 : -1) * part.size[2]) / 2)
      push(c.applyQuaternion(r).add(V(part.center)).applyMatrix4(m))
    }
  }
}

const D = Math.SQRT1_2
/** directions sampling a capsule's silhouette from any camera azimuth */
const CAPSULE_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [D, 0, D], [D, 0, -D], [-D, 0, D], [-D, 0, -D]]

/** body capsules over the loop (their extreme points), framed implement parts, and the floor under the feet */
export function framePoints(b: Baked, skel: Skeleton, samples = FRAME_SAMPLES): number[] {
  const out: number[] = []
  const dirs = CAPSULE_DIRS
  for (let n = 0; n < samples; n++) {
    const i = Math.floor((n * b.frames) / samples)
    const f = fk(skel, b.q.subarray(i * b.nDof, (i + 1) * b.nDof))
    for (const c of bodyCapsules(skel, f)) {
      for (const e of [c.a, c.b]) {
        for (const d of dirs) out.push(e[0] + d[0] * c.r, e[1] + d[1] * c.r, e[2] + d[2] * c.r)
        // the soft shadow reaches a few centimetres past whatever stands on the floor
        if (e[1] - c.r < 0.05) out.push(e[0], 0, e[2] + 0.06, e[0], 0, e[2] - 0.06, e[0] + 0.06, 0, e[2], e[0] - 0.06, 0, e[2])
      }
    }
    b.implements.forEach((spec, k) => {
      const o = (i * b.implements.length + k) * 7
      const m = m4([b.ip[o], b.ip[o + 1], b.ip[o + 2]], [b.ip[o + 3], b.ip[o + 4], b.ip[o + 5], b.ip[o + 6]])
      for (const part of framedParts(spec)) partPoints(part, m, out)
    })
  }
  // a cable stack stays readable: its column and base from the floor up to the pulley
  for (const c of b.cables ?? []) {
    out.push(...c.pulley)
    const stack = b.implements.find((s) => s.id === 'stack')
    const col = stack?.parts[0]
    if (col?.shape === 'cylinder') {
      for (const [dx, dz] of [[0.3, 0.3], [0.3, -0.3], [-0.3, 0.3], [-0.3, -0.3]]) out.push(col.a[0] + dx, 0, col.a[2] + dz, col.a[0] + dx, c.pulley[1] + 0.3, col.a[2] + dz)
    }
  }
  return out
}

/** machine parts that sit on the floor (feet, base rails, floor plates) stay in the picture; so do loaded plates */
const FLOOR_PART = 0.25
/** props framed whole: the pull-up station and the assisted machine read only with their base and top */
const WHOLE = new Set(['pullup', 'assisted-pullup'])

function propPoints(props: PropSpec[], poseAt: (u: number) => Poses): number[] {
  const out: number[] = []
  const id = new Matrix4()
  const addColliders = (colliders: Collider[], m: Matrix4, whole: boolean) => {
    for (const c of colliders) {
      const pts: number[] = []
      partPoints(c, m, pts)
      let top = -Infinity
      for (let i = 1; i < pts.length; i += 3) top = Math.max(top, pts[i])
      if (whole || c.kind === 'plate' || top < FLOOR_PART) out.push(...pts)
    }
  }
  const add = (pieces: Piece[], whole: boolean) => addColliders(pieceColliders(pieces), id, whole)
  for (const p of props) {
    // the adjustable bench's floor stabilisers reach past its implement parts
    if (p.type === 'bench') addColliders(benchColliders(p.params), new Matrix4().makeTranslation(...p.position), false)
    else if (p.type === 'rigid' && !p.attach) add(p.pieces, WHOLE.has(p.key) || !!p.whole)
    else if (p.type === 'dynamic') for (const u of [0, 0.25, 0.5, 0.75]) add(p.build(poseAt(u)), WHOLE.has(p.key) || !!p.whole)
  }
  return out
}

function floorExtent(points: number[], props: PropSpec[]) {
  let r = 1
  for (let i = 0; i < points.length; i += 3) if (points[i + 1] < 0.8) r = Math.max(r, Math.abs(points[i]), Math.abs(points[i + 2]))
  // machines reach further than the framed points (frames, feet, stacks)
  if (props.some((p) => p.type === 'dynamic' || p.key === 'bench')) r += 0.5
  return r + 0.4
}

// ---------- scene ----------

export function composeMotion(ex: MotionExercise, motion: CompactMotion | Baked, skel: Skeleton): MotionScene {
  const b = 'data' in motion ? decode(motion, skel) : motion
  const params = b.params
  const sample = sampler(b)
  const props = motionProps(b, params)
  const posesAt = (u: number): Poses => new Map(sample(u * b.duration).implements.map((p) => [p.id, p]))
  const frame = [...framePoints(b, skel), ...propPoints(props, posesAt)]
  return {
    baked: b,
    template: b.template,
    params,
    poseAt: (u) => sample(u * b.duration),
    pulseAt: (u) => {
      const p = phaseAt(u, b.tempo)
      return p.name === 'con' ? p.progress : null
    },
    midRep: midConcentric(b),
    highlight: motionHighlight(ex, params, b.template),
    hero: heroCamera(b.template, params, ex.media.mapView),
    grips: motionGrips(b, skel, params),
    props,
    frame,
    floor: floorExtent(frame, props),
  }
}

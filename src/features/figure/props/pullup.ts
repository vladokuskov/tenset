import { Vector3 } from 'three'
import { pullupBar, type ImplementSpec, type Part } from '../../../motion/implements.ts'
import { finish, Kit, vec, type PropBuild } from './kit'
import { cableRun, foot, pulley, WHEEL_R, weightStack } from './parts'
import { gripSocket, type GripSocket, type SurfaceSocket } from './sockets'

// Pull-up station and assisted pull-up machine around the motion's pull-up bar descriptor (1.3 m bar, grips from
// the template's grip width). Frame: X across, Y up, the lifter faces +Z and hangs under the bar at x = 0, z = 0.

type Cyl = Extract<Part, { shape: 'cylinder' }>
type V3 = [number, number, number]

export type PullupParams = {
  /** bar height (m); the vertical-pull template's BAR_HEIGHT is 2.4 */
  height?: number
  /** distance between grip centres (m) */
  gripWidth?: number
  /** parallel handles under the bar at the grip positions, as the template's neutral-grip bar */
  neutral?: boolean
  /** draw this descriptor (bar frame, e.g. the template's) instead */
  spec?: ImplementSpec
}

export const pullupDefaults = { height: 2.4, gripWidth: 0.68, neutral: false }

export type PullupSockets = { grips: Record<string, GripSocket>; bar: { position: Vector3; axis: Vector3; half: number } }

const P = 0.075

export function pullupSpec(p: PullupParams = {}): ImplementSpec {
  const o = { ...pullupDefaults, ...p }
  if (p.spec) return p.spec
  const spec = pullupBar({ height: o.height, gripWidth: o.gripWidth })
  if (!o.neutral) return spec
  const g = o.gripWidth / 2
  const cyl = (a: V3, b: V3, r: number): Cyl => ({ shape: 'cylinder', a, b, r })
  return {
    ...spec,
    parts: [...spec.parts, cyl([g, -0.02, -0.08], [g, -0.02, 0.08], 0.016), cyl([-g, -0.02, -0.08], [-g, -0.02, 0.08], 0.016)],
    sites: { l: { pos: [g, -0.02, 0], axis: [0, 0, 1] }, r: { pos: [-g, -0.02, 0], axis: [0, 0, 1] } },
  }
}

/** knurled bar and any parallel handles, in the station frame (bar centre at `at`) */
function drawBar(kit: Kit, spec: ImplementSpec, at: Vector3) {
  const parts = spec.parts.filter((c): c is Cyl => c.shape === 'cylinder')
  const bar = parts[0]
  const half = Math.abs(bar.b[0])
  kit.knurl(at.clone().setX(-half), at.clone().setX(half), bar.r)
  for (const h of parts.slice(1)) {
    // parallel handles run along Z; the descriptor's uprights are drawn by the frame
    if (Math.abs(h.a[2] - h.b[2]) < 0.01) continue
    const a = vec(h.a).add(at), b = vec(h.b).add(at)
    kit.knurl(a, b, h.r)
    kit.rod(a, a.clone().add(new Vector3(0, 0, -0.008)), h.r + 0.003, 'steel', 20)
    kit.rod(b, b.clone().add(new Vector3(0, 0, 0.008)), h.r + 0.003, 'steel', 20)
    kit.box(at.clone().setX(h.a[0]).add(new Vector3(0, (h.a[1] + 0.004) / 2, 0)), [0.034, Math.abs(h.a[1]) + 0.03, 0.036], 'steelDark', undefined, 0.006)
  }
  return half
}

function grips(spec: ImplementSpec, at: Vector3) {
  return Object.fromEntries(Object.entries(spec.sites).map(([k, s]) => {
    const g = gripSocket(s)
    return [k, { position: g.position.add(at), axis: g.axis }]
  }))
}

/** Free-standing pull-up station: two uprights on long braced feet, the bar between them. */
export function buildPullupStation(p: PullupParams = {}): PropBuild<PullupSockets> {
  const o = { ...pullupDefaults, ...p }
  const spec = pullupSpec(p)
  const kit = new Kit()
  const at = new Vector3(0, o.height, 0)
  const half = drawBar(kit, spec, at)
  const x = half + P / 2
  for (const s of [-1, 1]) {
    const xs = s * x
    kit.tube([xs, 0.025, -0.58], [xs, 0.025, 0.58], P, 0.05, 'frame', { side: [1, 0, 0], cap: 'both' })
    foot(kit, [xs, 0, -0.54])
    foot(kit, [xs, 0, 0.54])
    kit.tube([xs, 0.05, 0], [xs, o.height + 0.12, 0], P, P, 'frame', { cap: 'b' })
    for (const z of [-1, 1]) kit.tube([xs, 0.05, z * 0.44], [xs, 0.78, z * (P / 2 + 0.01)], 0.05, 0.05, 'frame', { side: [1, 0, 0] })
    // bar end plates
    kit.box([s * (half + 0.004), o.height, 0], [0.008, 0.12, 0.09], 'frame', undefined, 0.004)
    for (const dy of [-1, 1]) kit.bolt([s * (x + P / 2), o.height + dy * 0.035, 0], [s, 0, 0])
  }
  kit.tube([-x + P / 2, 0.025, -0.5], [x - P / 2, 0.025, -0.5], P, 0.05, 'frame', { side: [0, 0, 1] })
  return finish(kit, { grips: grips(spec, at), bar: { position: at, axis: new Vector3(1, 0, 0), half } })
}

export type AssistedPullupParams = PullupParams & {
  /** knee pad centre (the template's pad pose); default: the dead-hang position */
  pad?: V3
  stackLift?: number
}

/** knee pad path from the vertical-pull template (pad centre at dead hang and at the top), guides run parallel to it */
export const ASSIST_PAD = { bottom: [0, 0.709, -0.024] as V3, top: [0, 1.18, 0.07] as V3 }

export type AssistedPullupSockets = PullupSockets & {
  /** top of the knee pad */
  pad: SurfaceSocket
  padPath: { from: Vector3; to: Vector3 }
}

const TOWER_Z = 0.56
const GUIDE_OFFSET = 0.34

/** Assisted pull-up: tower in front with the counterweight stack, handles cantilevered over the lifter, a knee pad
 * on a carriage whose guide rods run parallel to the template's pad path. */
export function buildAssistedPullup(p: AssistedPullupParams = {}): PropBuild<AssistedPullupSockets> {
  const o = { ...pullupDefaults, ...p }
  const spec = pullupSpec(p)
  const kit = new Kit()
  const at = new Vector3(0, o.height, 0)
  const half = drawBar(kit, spec, at)
  const x = half + P / 2
  const bottom = vec(ASSIST_PAD.bottom), top = vec(ASSIST_PAD.top)
  const slope = (top.z - bottom.z) / (top.y - bottom.y)
  const pathZ = (y: number) => bottom.z + (y - bottom.y) * slope
  const pad = vec(p.pad ?? ASSIST_PAD.bottom)

  // tower and counterweight
  for (const s of [-1, 1]) {
    kit.tube([s * 0.2, 0.045, TOWER_Z], [s * 0.2, o.height - P / 2, TOWER_Z], 0.07, 0.07, 'frame')
    kit.tube([s * 0.36, 0.022, -0.12], [s * 0.36, 0.022, TOWER_Z + 0.16], 0.06, 0.045, 'frame', { side: [1, 0, 0], cap: 'both' })
    foot(kit, [s * 0.36, 0, -0.08], 0.07, 0.06)
    foot(kit, [s * 0.36, 0, TOWER_Z + 0.12], 0.07, 0.06)
    // handle arms from the tower back over the lifter
    kit.tube([s * x, o.height, TOWER_Z + 0.04], [s * x, o.height, -0.07], P, P, 'frame', { cap: 'b' })
    kit.box([s * (half + 0.004), o.height, 0], [0.008, 0.11, 0.09], 'frame', undefined, 0.004)
  }
  kit.tube([-x - P / 2, o.height, TOWER_Z], [x + P / 2, o.height, TOWER_Z], P, P, 'frame', { side: [0, 0, 1], cap: 'both' })
  for (const s of [-1, 1]) kit.tube([s * 0.2, o.height - 0.42, TOWER_Z], [s * 0.5, o.height - P / 2, TOWER_Z], 0.05, 0.05, 'frame', { side: [0, 0, 1] })
  for (const z of [TOWER_Z, 0.26, -0.08]) kit.tube([-0.33, 0.022, z], [0.33, 0.022, z], 0.06, 0.045, 'frame', { side: [0, 0, 1] })
  kit.tube([-0.2 + 0.035, 2.12, TOWER_Z], [0.2 - 0.035, 2.12, TOWER_Z], 0.05, 0.05, 'frame', { side: [0, 0, 1] })
  const stackTop = weightStack(kit, [0, 0, TOWER_Z], { top: 2.1, lift: p.stackLift, plates: 12 })

  // pad guides parallel to the pad path, carriage, arm and pad
  const g0 = 0.4, g1 = 1.55
  const guide = (y: number) => new Vector3(0, y, pathZ(y) + GUIDE_OFFSET)
  for (const s of [-1, 1]) {
    kit.rod(guide(g0).setX(s * 0.09), guide(g1).setX(s * 0.09), 0.014, 'steel', 20)
  }
  kit.box(guide(g0 - 0.02), [0.26, 0.05, 0.07], 'frame', undefined, 0.008)
  kit.tube([0, 0.045, pathZ(g0) + GUIDE_OFFSET], [0, g0 - 0.045, pathZ(g0) + GUIDE_OFFSET], 0.07, 0.07, 'frame')
  kit.box(guide(g1 + 0.02), [0.26, 0.05, 0.07], 'frame', undefined, 0.008)
  kit.tube(guide(g1 + 0.02).setZ(pathZ(g1) + GUIDE_OFFSET + 0.035), [0, g1 + 0.02, TOWER_Z - 0.035], 0.06, 0.05, 'frame')
  const cy = Math.min(Math.max(pad.y, g0 + 0.08), g1 - 0.08)
  const cz = pathZ(cy) + GUIDE_OFFSET
  // counterweight cable: carriage -> pulley in the tower -> stack
  const pw = new Vector3(0, g1 + 0.1, TOWER_Z - WHEEL_R)
  pulley(kit, pw, [1, 0, 0])
  kit.tube([-0.2 + 0.035, pw.y + 0.09, TOWER_Z], [0.2 - 0.035, pw.y + 0.09, TOWER_Z], 0.05, 0.05, 'frame', { side: [0, 0, 1] })
  kit.rod([0, pw.y + 0.06, pw.z], [0, pw.y + 0.07, pw.z], 0.012, 'steel', 16)
  kit.box([0, pw.y + 0.07, (pw.z + TOWER_Z) / 2], [0.03, 0.012, TOWER_Z - pw.z + 0.03], 'frameDark', undefined, 0.003)
  cableRun(kit, [new Vector3(0, cy + 0.015, cz), pw.clone().add(new Vector3(0, 0, -WHEEL_R))])
  cableRun(kit, [pw.clone().add(new Vector3(0, 0, WHEEL_R)), stackTop])
  kit.box([0, cy - 0.05, cz], [0.27, 0.13, 0.085], 'frameDark', undefined, 0.014)
  kit.knob([0.135, cy - 0.05, cz], [1, 0, 0], 0.014)
  kit.tube([0, pad.y - 0.07, cz - 0.04], [0, pad.y - 0.07, pad.z - 0.02], 0.06, 0.05, 'frame', { side: [1, 0, 0] })
  kit.box([0, pad.y - 0.041, pad.z], [0.38, 0.012, 0.3], 'frameDark', undefined, 0.004)
  kit.box(pad, [0.42, 0.07, 0.34], 'pad', undefined, 0.026)

  // steps either side of the pad
  for (const s of [-1, 1]) {
    kit.box([s * 0.36, 0.4, 0.3], [0.22, 0.03, 0.26], 'frame', undefined, 0.008)
    kit.box([s * 0.36, 0.419, 0.3], [0.2, 0.008, 0.24], 'rubber', undefined, 0.003)
    kit.tube([s * 0.36, 0.045, 0.3], [s * 0.36, 0.385, 0.3], 0.05, 0.05, 'frame')
    kit.tube([s * 0.36, 0.4, 0.43], [s * 0.2, 0.4, TOWER_Z - 0.035], 0.05, 0.04, 'frame', { side: [0, 1, 0] })
  }

  return finish(kit, {
    grips: grips(spec, at),
    bar: { position: at, axis: new Vector3(1, 0, 0), half },
    pad: { position: pad.clone().add(new Vector3(0, 0.035, 0)), normal: new Vector3(0, 1, 0), along: new Vector3(0, 0, 1), size: [0.34, 0.42] },
    padPath: { from: bottom, to: top },
  })
}

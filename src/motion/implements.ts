import { add, qrot, type Quat, type V3 } from './math.ts'
import type { ExtensionKind } from './implements/index.ts'
import type { ImplementPose } from './skeleton.ts'

// Pure geometry descriptors for props (not meshes). Local frames: bars and handles run along X; the pose
// transform places the local origin in the world. Sizes in metres, masses in kg.

/** core kinds; families add theirs in src/motion/implements/<family>.ts (KINDS) */
export type ImplementKind = 'barbell' | 'dumbbell' | 'ez_bar' | 'cable_handle' | 'bench' | 'pullup_bar' | ExtensionKind

/** `pad`: a padded support surface (bench pad, seat, knee pad, foot plate); the body may sink into it a little */
export type Part =
  | { shape: 'cylinder'; a: V3; b: V3; r: number; pad?: boolean }
  | { shape: 'box'; center: V3; size: V3; rot?: Quat; pad?: boolean }

/** a grip or contact point; `axis` is the handle direction the hand's pinky-to-index line aligns with */
export type Site = { pos: V3; axis?: V3; normal?: V3 }

export type ImplementSpec = {
  id: string
  kind: ImplementKind
  mass: number
  com: V3
  parts: Part[]
  sites: Record<string, Site>
}

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

export const PLATE_20_RADIUS = 0.225

/** Olympic bar, 2.2 m, 20 kg; grips at +-gripWidth/2 (left hand on +X) */
export function barbell(o: { id?: string; gripWidth: number; plateKg?: number }): ImplementSpec {
  const plate = o.plateKg ?? 40
  const parts: Part[] = [cyl([-0.655, 0, 0], [0.655, 0, 0], 0.014)]
  for (const s of [1, -1]) {
    parts.push(cyl([0.655 * s, 0, 0], [1.1 * s, 0, 0], 0.025))
    parts.push(cyl([0.64 * s, 0, 0], [0.655 * s, 0, 0], 0.04))
    let x = 0.665
    for (let kg = plate; kg > 0; ) {
      const p = kg >= 20 ? 20 : kg >= 10 ? 10 : 5
      const r = p === 20 ? PLATE_20_RADIUS : p === 10 ? 0.16 : 0.115
      const w = p === 20 ? 0.05 : 0.035
      parts.push(cyl([x * s, 0, 0], [(x + w) * s, 0, 0], r))
      x += w + 0.003
      kg -= p
    }
  }
  const g = o.gripWidth / 2
  return {
    id: o.id ?? 'bar',
    kind: 'barbell',
    mass: 20 + 2 * plate,
    com: [0, 0, 0],
    parts,
    sites: { l: { pos: [g, 0, 0], axis: [1, 0, 0] }, r: { pos: [-g, 0, 0], axis: [1, 0, 0] } },
  }
}

export function dumbbell(o: { id: string; mass?: number }): ImplementSpec {
  const mass = o.mass ?? 12
  const r = 0.055 + mass * 0.0018
  const w = 0.03 + mass * 0.0028
  return {
    id: o.id,
    kind: 'dumbbell',
    mass,
    com: [0, 0, 0],
    parts: [cyl([-0.065, 0, 0], [0.065, 0, 0], 0.016), cyl([0.065, 0, 0], [0.065 + w, 0, 0], r), cyl([-0.065, 0, 0], [-0.065 - w, 0, 0], r)],
    sites: { c: { pos: [0, 0, 0], axis: [1, 0, 0] } },
  }
}

/** EZ bar: outer (l/r) and inner (l_in/r_in) angled grips; the bends lie in the bar's XZ plane. `inner`: half the
 * inner grip width (centre of the inner bend), 0.2 m by default */
export function ezBar(o: { id?: string; plateKg?: number; inner?: number }): ImplementSpec {
  const plate = o.plateKg ?? 10
  const g = o.inner ?? 0.2
  const e = g + 0.15
  const pts: V3[] = [[-0.6, 0, 0], [-e, 0, 0], [-g - 0.05, 0, 0.03], [-g + 0.05, 0, 0], [g - 0.05, 0, 0], [g + 0.05, 0, 0.03], [e, 0, 0], [0.6, 0, 0]]
  const parts: Part[] = []
  for (let i = 0; i + 1 < pts.length; i++) parts.push(cyl(pts[i], pts[i + 1], i === 0 || i === pts.length - 2 ? 0.025 : 0.014))
  for (const s of [1, -1]) parts.push(cyl([0.42 * s, 0, 0], [(0.42 + 0.035) * s, 0, 0], 0.16))
  const tilt = (s: number): V3 => [0.958, 0, -0.287 * s]
  return {
    id: o.id ?? 'bar',
    kind: 'ez_bar',
    mass: 10 + 2 * plate,
    com: [0, 0, 0],
    parts,
    sites: {
      l: { pos: [g + 0.1, 0, 0.015], axis: tilt(1) },
      r: { pos: [-g - 0.1, 0, 0.015], axis: tilt(-1) },
      l_in: { pos: [g, 0, 0.015], axis: tilt(-1) },
      r_in: { pos: [-g, 0, 0.015], axis: tilt(1) },
    },
  }
}

export type Attachment = 'rope' | 'straight_bar' | 'ez_bar' | 'v_bar' | 'single_handle' | 'long_bar' | 'ankle_strap'

/** cable attachment; local origin at the carabiner, handles hang towards -Y */
export function cableHandle(o: { id?: string; attachment: Attachment }): ImplementSpec {
  const id = o.id ?? 'handle'
  const base = { id, kind: 'cable_handle' as const, mass: 0.5, com: [0, -0.05, 0] as V3 }
  switch (o.attachment) {
    case 'rope':
      return {
        ...base,
        parts: [cyl([0, 0, 0], [0.12, -0.28, 0], 0.012), cyl([0, 0, 0], [-0.12, -0.28, 0], 0.012)],
        sites: { l: { pos: [0.11, -0.22, 0], axis: [0, 1, 0] }, r: { pos: [-0.11, -0.22, 0], axis: [0, 1, 0] } },
      }
    case 'v_bar':
      return {
        ...base,
        parts: [cyl([0, 0, 0], [0, -0.1, 0], 0.012), cyl([0.07, -0.1, -0.06], [0.07, -0.1, 0.06], 0.015), cyl([-0.07, -0.1, -0.06], [-0.07, -0.1, 0.06], 0.015)],
        sites: { l: { pos: [0.07, -0.1, 0], axis: [0, 0, 1] }, r: { pos: [-0.07, -0.1, 0], axis: [0, 0, 1] } },
      }
    case 'straight_bar':
    case 'ez_bar':
    case 'long_bar': {
      const w = o.attachment === 'long_bar' ? 0.6 : 0.25
      return {
        ...base,
        parts: [cyl([0, 0, 0], [0, -0.05, 0], 0.01), cyl([-w, -0.05, 0], [w, -0.05, 0], 0.014)],
        sites: { l: { pos: [w * 0.8, -0.05, 0], axis: [1, 0, 0] }, r: { pos: [-w * 0.8, -0.05, 0], axis: [1, 0, 0] } },
      }
    }
    case 'ankle_strap':
      return { ...base, parts: [cyl([0, 0, 0], [0, -0.06, 0], 0.03)], sites: { c: { pos: [0, -0.06, 0] } } }
    case 'single_handle':
      return {
        ...base,
        parts: [cyl([0, 0, 0], [0.05, -0.08, 0], 0.006), cyl([0, 0, 0], [-0.05, -0.08, 0], 0.006), cyl([-0.06, -0.09, 0], [0.06, -0.09, 0], 0.016)],
        sites: { c: { pos: [0, -0.09, 0], axis: [1, 0, 0] } },
      }
  }
}

/** Bench with a seat and a back pad hinged at the local origin (on the seat surface); back angle 0 = flat, 90 = upright. +Z is the seat end. */
export function bench(o: { id?: string; backAngle?: number; seatHeight?: number; backLength?: number; seat?: boolean }): ImplementSpec {
  const h = o.seatHeight ?? 0.43
  const a = ((o.backAngle ?? 0) * Math.PI) / 180
  const L = o.backLength ?? 0.84
  const back: V3 = [0, Math.sin(a), -Math.cos(a)]
  const backRot: Quat = [Math.sin(a / 2), 0, 0, Math.cos(a / 2)]
  const pad: Part = { shape: 'box', center: add(scale3(back, L / 2), qrot(backRot, [0, -0.03, 0])), size: [0.28, 0.06, L], rot: backRot, pad: true }
  const sites = { seat: { pos: [0, 0, 0.2] as V3, normal: [0, 1, 0] as V3 }, back: { pos: scale3(back, L * 0.48), normal: qrot(backRot, [0, 1, 0]) } }
  if (o.seat === false) {
    // a pad on a single post (chest-supported work where the legs go under the pad's lower end)
    const mid = scale3(back, L / 2)
    return { id: o.id ?? 'bench', kind: 'bench', mass: 0, com: [0, 0, 0], parts: [pad, cyl([0, mid[1] - 0.06, mid[2]], [0, -h, mid[2]], 0.03), cyl([0, -h + 0.02, mid[2] - 0.35], [0, -h + 0.02, mid[2] + 0.35], 0.03)], sites }
  }
  return {
    id: o.id ?? 'bench',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      { shape: 'box', center: [0, -0.03, 0.22], size: [0.28, 0.06, 0.44], pad: true },
      pad,
      cyl([0, -0.06, 0.4], [0, -h, 0.4], 0.025),
      cyl([0, -0.06, -0.5], [0, -h, -0.5], 0.025),
      cyl([0, -h + 0.02, -0.6], [0, -h + 0.02, 0.5], 0.03),
    ],
    sites,
  }
}

const scale3 = (v: V3, s: number): V3 => [v[0] * s, v[1] * s, v[2] * s]

/**
 * neutral-grip handles on a pull-up bar: welded to the bar at the grip width and running back (-Z), level with it, so
 * the lifter hangs behind the bar and pulls the chest towards it with the head clear. Long and thick enough that
 * they show past the fists at 480 px.
 */
export const NEUTRAL_HANDLE = { from: -0.07, to: -0.35, r: 0.018, stub: 0.023 }

/** pull-up bar; local origin at the bar centre, uprights down to the floor. `neutral`: parallel handles at the grips */
export function pullupBar(o: { id?: string; height: number; gripWidth: number; neutral?: boolean }): ImplementSpec {
  const g = o.gripWidth / 2
  const parts = [cyl([-0.65, 0, 0], [0.65, 0, 0], 0.016), cyl([0.65, 0, 0], [0.65, -o.height, 0], 0.03), cyl([-0.65, 0, 0], [-0.65, -o.height, 0], 0.03)]
  const spec: ImplementSpec = {
    id: o.id ?? 'pullup',
    kind: 'pullup_bar',
    mass: 0,
    com: [0, 0, 0],
    parts,
    sites: { l: { pos: [g, 0, 0], axis: [1, 0, 0] }, r: { pos: [-g, 0, 0], axis: [1, 0, 0] } },
  }
  if (!o.neutral) return spec
  const { from, to, r, stub } = NEUTRAL_HANDLE
  for (const x of [g, -g]) parts.push(cyl([x, 0, from], [x, 0, to], r), cyl([x, 0, 0], [x, 0, from], stub))
  const mid = (from + to) / 2
  spec.sites = { l: { pos: [g, 0, mid], axis: [0, 0, 1] }, r: { pos: [-g, 0, mid], axis: [0, 0, 1] } }
  return spec
}

/** a site of a posed implement in world space */
export function siteWorld(spec: ImplementSpec, pose: ImplementPose, name: string): Site {
  const s = spec.sites[name]
  if (!s) throw new Error(`${spec.id} has no site ${name}`)
  return {
    pos: add(pose.pos, qrot(pose.rot, s.pos)),
    axis: s.axis ? qrot(pose.rot, s.axis) : undefined,
    normal: s.normal ? qrot(pose.rot, s.normal) : undefined,
  }
}

export function comWorld(spec: ImplementSpec, pose: ImplementPose): V3 {
  return add(pose.pos, qrot(pose.rot, spec.com))
}

/** a cable from a fixed pulley to a point on an implement (implement-local), pulling with the stack weight */
export type Cable = { pulley: V3; implement: string; point: V3; kg: number }

/** where a cable attaches this frame and the force it applies there, newtons */
export function cableForce(c: Cable, pose: ImplementPose): { at: V3; force: V3 } {
  const at = add(pose.pos, qrot(pose.rot, c.point))
  const d = [c.pulley[0] - at[0], c.pulley[1] - at[1], c.pulley[2] - at[2]]
  const n = Math.hypot(d[0], d[1], d[2]) || 1
  const k = (c.kg * 9.81) / n
  return { at, force: [d[0] * k, d[1] * k, d[2] * k] }
}

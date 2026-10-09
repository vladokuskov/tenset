import { localToWorld, segRot, type FK } from '../fk.ts'
import type { ImplementSpec, Part } from '../implements.ts'
import { add, cross, dot, len, norm, qalign, qrot, scale, sub, type V3 } from '../math.ts'
import type { ImplementPose, Skeleton } from '../skeleton.ts'
import { WALL, SKIRTING } from './shared.ts'

// Resistance bands (docs/FAMILIES.md "Resistance bands"). A band is a flat strip drawn every frame through a path of
// points that ride on other implements: band handles, a bare band bunched in the fist, a wall or post anchor, the
// pull-up bar, or free `band_node`s the template poses on the body (under the feet, round the knees, across the back).
// The band itself has no parts, so no gate collides with it; handles, the fist grip and the anchor are solid.

export const KINDS = ['band', 'band_node', 'band_handle', 'band_grip', 'band_anchor'] as const
export const MOVING: readonly string[] = ['band_handle', 'band_grip']

/** flat latex loop band: strip width by resistance (mini = the short wide loop worn round the legs), thickness (m) */
export const BAND = { width: { light: 0.013, medium: 0.021, heavy: 0.032, mini: 0.05 }, thick: 0.0045 }
export type BandSize = keyof typeof BAND.width

/**
 * A point of the band path: an implement's origin, or one of its sites, plus an optional offset `at` in the
 * implement's frame. `face`: the band's face normal there, in the implement's frame (a band lying flat on a thigh
 * faces outwards, one under a sole faces down); without it the strip keeps its width vertical (horizontal runs) or
 * across X (vertical runs).
 */
export type BandPoint = { implement: string; site?: string; at?: V3; face?: V3 }

export type BandData = { path: BandPoint[]; closed: boolean; width: number; thick: number }
export type BandSpec = ImplementSpec & { kind: 'band'; band: BandData }

export const isBand = (s: ImplementSpec): s is BandSpec => s.kind === 'band' && 'band' in s

/**
 * The band: no parts, posed anywhere (use `bandPose`), drawn through `path` every frame. `closed` joins the last point
 * back to the first (a loop round the legs). Path entries may be implement ids (their origin).
 */
export function band(o: { id?: string; path: (string | BandPoint)[]; closed?: boolean; size?: BandSize; width?: number }): BandSpec {
  return {
    id: o.id ?? 'band',
    kind: 'band',
    mass: 0,
    com: [0, 0, 0],
    parts: [],
    sites: {},
    band: {
      path: o.path.map((p) => (typeof p === 'string' ? { implement: p } : p)),
      closed: o.closed ?? false,
      width: o.width ?? BAND.width[o.size ?? 'medium'],
      thick: BAND.thick,
    },
  }
}

/** the band's own pose (any constant pose: the path carries the geometry) */
export const bandPose = (id = 'band'): ImplementPose => ({ id, pos: [0, 0, 0], rot: [0, 0, 0, 1] })

/** a free path point with no parts, posed by the template (on a body segment: `segmentNodePose` in templates) */
export function bandNode(id: string): ImplementSpec {
  return { id, kind: 'band_node', mass: 0, com: [0, 0, 0], parts: [], sites: { c: { pos: [0, 0, 0] } } }
}

/**
 * Points of an arc (or ellipse) round a node's local axis, for a band wrapped round a limb or the trunk. Angles in
 * degrees: about Y, 0 = +X and 90 = +Z; about X, 0 = +Y and 90 = +Z; about Z, 0 = +X and 90 = +Y. `r` is the radius,
 * or [radius along the 0 deg direction, radius along 90 deg]. Each point faces radially outwards.
 */
export function around(implement: string, o: { r: number | [number, number]; from: number; to: number; n?: number; axis?: 'x' | 'y' | 'z'; center?: V3 }): BandPoint[] {
  const [ra, rb] = typeof o.r === 'number' ? [o.r, o.r] : o.r
  const n = o.n ?? Math.max(3, Math.ceil(Math.abs(o.to - o.from) / 20) + 1)
  const c = o.center ?? [0, 0, 0]
  const [u, v]: [V3, V3] = o.axis === 'x' ? [[0, 1, 0], [0, 0, 1]] : o.axis === 'z' ? [[1, 0, 0], [0, 1, 0]] : [[1, 0, 0], [0, 0, 1]]
  const out: BandPoint[] = []
  for (let k = 0; k < n; k++) {
    const a = ((o.from + ((o.to - o.from) * k) / (n - 1)) * Math.PI) / 180
    const ca = Math.cos(a), sa = Math.sin(a)
    const at = add(c, add(scale(u, ra * ca), scale(v, rb * sa)))
    // ellipse normal: gradient of (x/ra)^2 + (y/rb)^2
    const face = norm(add(scale(u, ca / ra), scale(v, sa / rb)))
    out.push({ implement, at, face })
  }
  return out
}

/** soft band handle: foam grip on a webbing loop; local origin at the ring the band clips to, grip hanging towards -Y */
export const BAND_HANDLE = { drop: 0.085, half: 0.065, r: 0.017, ring: 0.014 }

/** Band handle. Sites: `c` grip centre (axis along the grip, X), `ring` where the band attaches (path point). */
export function bandHandle(o: { id: string }): ImplementSpec {
  const { drop, half, r } = BAND_HANDLE
  const parts: Part[] = [{ shape: 'cylinder', a: [-half, -drop, 0], b: [half, -drop, 0], r }]
  return { id: o.id, kind: 'band_handle', mass: 0.15, com: [0, -drop, 0], parts, sites: { c: { pos: [0, -drop, 0], axis: [1, 0, 0] }, ring: { pos: [0, 0, 0] } } }
}

/** a bare band bunched in the fist: grip length across the palm and the bunch radius (m) */
export const BAND_GRIP = { half: 0.05, r: 0.011 }

/**
 * A bare band gripped in the fist (wrap grip round the bunched band). Sites: `c` grip centre (axis X, little finger to
 * index), `a` and `b` where the band leaves the fist on the index (+X) and little-finger (-X) sides (path points).
 */
export function bandGrip(o: { id: string }): ImplementSpec {
  const { half, r } = BAND_GRIP
  return {
    id: o.id,
    kind: 'band_grip',
    mass: 0,
    com: [0, 0, 0],
    parts: [{ shape: 'cylinder', a: [-half, 0, 0], b: [half, 0, 0], r }],
    sites: { c: { pos: [0, 0, 0], axis: [1, 0, 0] }, a: { pos: [half, 0, 0] }, b: { pos: [-half, 0, 0] } },
  }
}

/** band anchor: a strap and ring on a wall section or a free-standing post; `hook` stands `reach` off the face */
export const BAND_ANCHOR = { post: { width: 0.075, height: 2.1, base: 0.5, plate: 0.012 }, reach: 0.045, r: 0.012 }
export type AnchorMount = 'wall' | 'post'
export type AnchorSpec = ImplementSpec & { kind: 'band_anchor'; mount: AnchorMount }

export const isAnchor = (s: ImplementSpec): s is AnchorSpec => s.kind === 'band_anchor' && 'mount' in s

/**
 * Band anchor at `height` (m above the floor). Local origin on the floor; the mounting face is the plane z = 0 facing
 * +Z (the wall face as in `wallSection`, or the front of a 75 mm post on a floor plate centred under it). Sites: `hook`
 * (the ring the band loops through, path point) and `face` (the mounting face at the hook height, normal +Z).
 */
export function bandAnchor(o: { id?: string; height: number; mount?: AnchorMount }): AnchorSpec {
  const mount = o.mount ?? 'wall'
  const h = o.height, { reach, r } = BAND_ANCHOR
  const parts: Part[] = []
  if (mount === 'wall') {
    parts.push({ shape: 'box', center: [0, WALL.height / 2, -WALL.thick / 2], size: [WALL.width, WALL.height, WALL.thick] })
    parts.push({ shape: 'box', center: [0, SKIRTING.height / 2, SKIRTING.depth / 2], size: [WALL.width, SKIRTING.height, SKIRTING.depth] })
  } else {
    const { width: w, height: H, base, plate } = BAND_ANCHOR.post
    parts.push({ shape: 'box', center: [0, H / 2, -w / 2], size: [w, H, w] })
    parts.push({ shape: 'box', center: [0, plate / 2, -w / 2], size: [base, plate, base] })
  }
  parts.push({ shape: 'cylinder', a: [0, h, 0], b: [0, h, reach], r })
  return {
    id: o.id ?? 'anchor',
    kind: 'band_anchor',
    mount,
    mass: 0,
    com: [0, 0, 0],
    parts,
    sites: { hook: { pos: [0, h, reach] }, face: { pos: [0, h, 0], normal: [0, 0, 1] } },
  }
}

export type BandVertex = { pos: V3; face?: V3 }

/** the band path in world space for one frame */
export function bandPath(spec: BandSpec, specs: ReadonlyMap<string, ImplementSpec>, poses: ReadonlyMap<string, ImplementPose>): BandVertex[] {
  return spec.band.path.map((p) => {
    const s = specs.get(p.implement), pose = poses.get(p.implement)
    if (!s || !pose) throw new Error(`band ${spec.id}: no implement ${p.implement}`)
    const local = add(p.site ? s.sites[p.site]?.pos ?? missing(spec.id, p) : [0, 0, 0], p.at ?? [0, 0, 0])
    const pos = add(pose.pos, qrot(pose.rot, local))
    return p.face ? { pos, face: norm(qrot(pose.rot, p.face)) } : { pos }
  })
}

function missing(band: string, p: BandPoint): never {
  throw new Error(`band ${band}: ${p.implement} has no site ${p.site}`)
}

/**
 * The strip's width direction on a run from a to b: across the face normal hint when there is one, else the vertical
 * projected off the run (horizontal runs), blending to X on near vertical runs.
 */
export function bandWidthAxis(a: V3, b: V3, face?: V3): V3 {
  const d = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]])
  if (face) {
    const w = cross(face, d)
    if (len(w) > 0.2) return norm(w)
  }
  const up: V3 = [0, 1, 0]
  const vert = Math.abs(dot(d, up))
  const t = Math.min(1, Math.max(0, (vert - 0.75) / 0.2))
  const hint = add(scale(up, 1 - t), scale([1, 0, 0], t))
  const w = add(hint, scale(d, -dot(hint, d)))
  return len(w) > 1e-6 ? norm(w) : [1, 0, 0]
}

/** a node pose riding on a body segment: `local` in the segment frame (world aligned in the zero pose, so a femur
 * node's Y runs along the thigh) */
export function segmentPose(skel: Skeleton, f: FK, id: string, segment: string, local: V3 = [0, 0, 0]): ImplementPose {
  return { id, pos: localToWorld(skel, f, segment, local), rot: segRot(skel, f, segment) }
}

/**
 * Pose a handle-like implement (band handle, band grip) so its `site` sits at `at` with the site axis along `axis`
 * (little finger to index) and its local +Y turned as far towards `toward` as the axis allows (the ring or the
 * band's exit towards the anchor).
 */
export function poseHandle(spec: ImplementSpec, site: string, at: V3, axis: V3, toward: V3): ImplementPose {
  const s = spec.sites[site]
  const up = sub(toward, at)
  const rot = qalign(s.axis ?? [1, 0, 0], [0, 1, 0], axis, len(cross(norm(axis), norm(up))) > 1e-6 ? up : [0, 1, 0])
  return { id: spec.id, pos: sub(at, qrot(rot, s.pos)), rot }
}

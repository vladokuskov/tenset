import { add, qid, qmul, qpow, qrot, scale, type Quat, type V3 } from './math.ts'
import { jointRotation, BODY_MASS, type Skeleton } from './skeleton.ts'

/** world transform of every canonical segment, indexed like skel.segments */
export type FK = { rot: Quat[]; pos: V3[] }

export function fk(skel: Skeleton, q: ArrayLike<number>): FK {
  const n = skel.segments.length
  const rot: Quat[] = new Array(n)
  const pos: V3[] = new Array(n)
  const jointRot: (Quat | undefined)[] = new Array(skel.joints.length)
  const jr = (j: number) => (jointRot[j] ??= jointRotation(skel, skel.joints[j], q))
  const d = skel.dof
  for (const s of skel.segments) {
    let local = qid()
    for (const { joint, weight } of s.joints) {
      const r = jr(joint)
      local = qmul(local, weight === 1 ? r : qpow(r, weight))
    }
    if (s.parent < 0) {
      rot[s.index] = local
      pos[s.index] = [q[d['pelvis.tx']], q[d['pelvis.ty']], q[d['pelvis.tz']]]
    } else {
      rot[s.index] = qmul(rot[s.orient], local)
      pos[s.index] = add(pos[s.parent], qrot(rot[s.parent], s.offset))
    }
  }
  return { rot, pos }
}

export function segPos(skel: Skeleton, f: FK, name: string): V3 {
  return f.pos[skel.seg[name]]
}

export function segRot(skel: Skeleton, f: FK, name: string): Quat {
  return f.rot[skel.seg[name]]
}

/** world point of a segment-local point */
export function localToWorld(skel: Skeleton, f: FK, segment: string, local: V3): V3 {
  const i = skel.seg[segment]
  return add(f.pos[i], qrot(f.rot[i], local))
}

export function sitePos(skel: Skeleton, f: FK, name: string): V3 {
  const s = skel.data.sites[name]
  if (!s) throw new Error(`unknown site ${name}`)
  return localToWorld(skel, f, s.segment, s.local)
}

/** site position plus its axis/normal directions in world space when defined */
export function siteFrame(skel: Skeleton, f: FK, name: string): { pos: V3; axis?: V3; normal?: V3 } {
  const s = skel.data.sites[name]
  if (!s) throw new Error(`unknown site ${name}`)
  const r = f.rot[skel.seg[s.segment]]
  return {
    pos: localToWorld(skel, f, s.segment, s.local),
    axis: s.axis ? qrot(r, s.axis) : undefined,
    normal: s.normal ? qrot(r, s.normal) : undefined,
  }
}

export type PointMass = { mass: number; pos: V3 }

/** whole-body centre of mass (BODY_MASS kg) plus optional external loads, world space */
export function centerOfMass(skel: Skeleton, f: FK, loads: PointMass[] = []): V3 {
  let m = 0
  let acc: V3 = [0, 0, 0]
  for (const s of skel.segments) {
    if (!s.mass) continue
    const w = s.mass * BODY_MASS
    acc = add(acc, scale(add(f.pos[s.index], qrot(f.rot[s.index], s.com)), w))
    m += w
  }
  for (const l of loads) {
    acc = add(acc, scale(l.pos, l.mass))
    m += l.mass
  }
  return scale(acc, 1 / m)
}

export const GRAVITY = 9.81

/** a force applied at a point, newtons (cable pulls) */
export type PointForce = { at: V3; force: V3 }

/**
 * Centre of pressure on the floor for static equilibrium of body + loads under gravity plus external point forces:
 * moments about the floor origin give c_h = (sum m g p_h + a_y F_h - a_h F_y) / (M g - F_y) for h in {x, z}.
 * Returns [x, z]; with no forces it is the centre of mass.
 */
export function centerOfPressure(skel: Skeleton, f: FK, loads: PointMass[] = [], forces: PointForce[] = []): [number, number] {
  let m = loads.reduce((a, l) => a + l.mass, 0)
  for (const s of skel.segments) m += s.mass * BODY_MASS
  const com = centerOfMass(skel, f, loads)
  let nx = m * GRAVITY * com[0], nz = m * GRAVITY * com[2], den = m * GRAVITY
  for (const { at, force } of forces) {
    nx += at[1] * force[0] - at[0] * force[1]
    nz += at[1] * force[2] - at[2] * force[1]
    den -= force[1]
  }
  return [nx / den, nz / den]
}

/** stick-figure joint chain for drawing: [from, to] world points per segment */
export function sticks(skel: Skeleton, f: FK): { segment: string; a: V3; b: V3 }[] {
  const out: { segment: string; a: V3; b: V3 }[] = []
  for (const s of skel.segments) {
    if (s.parent < 0) continue
    out.push({ segment: s.name, a: f.pos[s.parent], b: f.pos[s.index] })
  }
  const tip = (seg: string, site: string) => out.push({ segment: seg, a: segPos(skel, f, seg), b: sitePos(skel, f, site) })
  for (const side of ['l', 'r']) {
    tip(`hand_${side}`, `grip_${side}`)
    tip(`toes_${side}`, `toe_${side}`)
    out.push({ segment: `foot_${side}`, a: sitePos(skel, f, `heel_${side}`), b: sitePos(skel, f, `ball_${side}`) })
  }
  tip('head', 'head_top')
  return out
}

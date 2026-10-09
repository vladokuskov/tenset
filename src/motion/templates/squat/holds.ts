import { attachHand, handFrame } from '../../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { fk, localToWorld, type FK } from '../../fk.ts'
import { kettlebell } from '../../implements/free-weights.ts'
import type { ImplementSpec } from '../../implements.ts'
import { add, cross, DEG, dot, norm, qaxis, qconj, qid, qmul, qrot, scale, sub, type Quat, type V3 } from '../../math.ts'
import { setDofs, setScapula, type ImplementPose, type Side, type Skeleton } from '../../skeleton.ts'

// Loads held in front of the body without a bar, shared by the squat and the lunge: a kettlebell by the horns against
// the chest (goblet), two kettlebells in the front rack, and one dumbbell hanging between the legs with its top head
// cupped in both hands (sumo squat).

const ARM_DOFS = ['clavicle_*.prot', 'clavicle_*.elev', 'scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev', 'grip_*.close']

export function mirrorArm(skel: Skeleton, q: Float64Array) {
  for (const k of ARM_DOFS) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

/** the left arm's DOFs mirrored onto both arms, as (index, value) pairs */
export function armPairs(skel: Skeleton, q: Float64Array): [number, number][] {
  return ARM_DOFS.flatMap((k) => {
    const x = q[skel.dof[k.replace('*', 'l')]]
    return [[skel.dof[k.replace('*', 'l')], x], [skel.dof[k.replace('*', 'r')], x]] as [number, number][]
  })
}

// ---------- kettlebell goblet ----------

/** goblet kettlebell, kg */
export const KB_GOBLET_KG = 20
/** bell centre this far below the sternum site, and sunk this far into the chest (m) */
const KB_GOBLET = { drop: 0.035, sink: 0.004 }

export const kbGoblet = () => kettlebell({ id: 'kb', kg: KB_GOBLET_KG })

let kbLast: { skel: Skeleton; key: string; pose: ImplementPose } | null = null

/** goblet kettlebell: upright, the bell against the chest under the sternum, handle up, horns to the hands */
export function kbGobletPose(skel: Skeleton, f: FK, spec: ImplementSpec): ImplementPose {
  const t = skel.seg.thorax2
  const key = `${spec.id}|${f.pos[t].join()}|${f.rot[t].join()}`
  if (kbLast?.skel === skel && kbLast.key === key) return kbLast.pose
  const base = add(localToWorld(skel, f, 'thorax2', skel.data.sites.sternum.local), [0, -KB_GOBLET.drop, 0])
  const fwd = qrot(f.rot[t], [0, 0, 1])
  const dir = norm([fwd[0], 0, fwd[2]])
  const chest = bodyCapsules(skel, f).filter((c) => c.region === 'trunk' && c.segment.startsWith('thorax'))
  const at = (d: number): ImplementPose => ({ id: spec.id, pos: add(base, scale(dir, d)), rot: qid() })
  const bell = { ...spec, parts: spec.parts.slice(0, 6) }
  const gap = (d: number) => Math.min(...placeParts(bell, at(d)).flatMap((sd) => chest.map((c) => capsuleSolidClearance(c, sd)))) + KB_GOBLET.sink
  let d0 = 0.1, d1 = 0.2, g0 = gap(d0), g1 = gap(d1)
  for (let k = 0; k < 12 && Math.abs(g1) > 1e-6 && g1 !== g0; k++) {
    const d2 = Math.min(0.4, Math.max(0, d1 - (g1 * (d1 - d0)) / (g1 - g0)))
    ;[d0, g0, d1, g1] = [d1, g1, d2, gap(d2)]
  }
  const pose = at(d1)
  kbLast = { skel, key, pose }
  return pose
}

/** both hands on the horns, palms in, elbows down (left solved, right mirrored) */
export function kbGobletArms(skel: Skeleton, q: Float64Array, spec: ImplementSpec) {
  setDofs(skel, q, { 'clavicle_*.prot': 6, 'clavicle_*.elev': 2, 'grip_*.close': 1 })
  const pose = kbGobletPose(skel, fk(skel, q), spec)
  const s = spec.sites.horn_l
  const pos = add(pose.pos, qrot(pose.rot, s.pos))
  const axis = qrot(pose.rot, s.axis!)
  const palm = norm(sub([-1, 0, -0.35], scale(axis, dot([-1, 0, -0.35], axis))))
  attachHand(skel, q, 'l', { pos, axis, palm }, { pole: [0.15, -1, 0.2], planeHint: 60, wristBias: 15 })
  mirrorArm(skel, q)
}

// ---------- double kettlebell front rack ----------

export const KB_RACK_KG = 16
/**
 * Front rack: the hand at the collarbone in front of the shoulder, palm in and back, the forearm about vertical and
 * the elbow tucked against the ribs; the handle runs diagonally across the palm (a top corner in the hand) and the bell
 * lies on the outside of the forearm, beside and behind the wrist, in the shelf between the forearm, the biceps and the
 * chest. Hand target in the thorax frame (left side), m; the bell centre at least `side` lateral of the wrist.
 */
const KB_RACK = { hand: [0.05, 0.24, 0.14] as V3, side: 0.06, palm: [-0.7, 0, -1] as V3, axis: [0.2, 1, 0] as V3, pole: [0.3, -1, 0.2] as V3, sink: 0.008 }

export const kbRackPair = () => [kettlebell({ id: 'kb_l', kg: KB_RACK_KG }), kettlebell({ id: 'kb_r', kg: KB_RACK_KG })]

/** rack arm DOFs: solved once in a standing pose for the left arm and mirrored */
export function kbRackArmPairs(skel: Skeleton, q0: Float64Array): [number, number][] {
  const q = q0.slice()
  setDofs(skel, q, { 'clavicle_*.prot': 4, 'clavicle_*.elev': 6, 'grip_*.close': 1 })
  const f = fk(skel, q)
  const T = f.rot[skel.seg.thorax2]
  const pos = localToWorld(skel, f, 'thorax2', add(skel.data.sites.sternum.local, KB_RACK.hand))
  attachHand(skel, q, 'l', { pos, axis: qrot(T, norm(KB_RACK.axis)), palm: qrot(T, norm(KB_RACK.palm)) }, { pole: qrot(T, KB_RACK.pole), planeHint: 70, wristBias: 0 })
  setScapula(skel, q, 'l')
  return armPairs(skel, q)
}

/**
 * The left bell's pose in the left hand's frame: the corner in the hand along the grip axis, turned about it until the
 * bell rests on the outside of the forearm and the biceps, no further forward than the wrist. The right is its mirror
 * image.
 */
export function kbRackInHand(skel: Skeleton, q0: Float64Array, spec: ImplementSpec): { pos: V3; rot: Quat; site: string } {
  const f = fk(skel, q0)
  const h = handFrame(skel, f, 'l')
  const caps = bodyCapsules(skel, f)
  const region = (r: string) => caps.filter((c) => c.region === r)
  const [hand, forearm, upperarm, chest] = [region('hand_l'), region('forearm_l'), region('upperarm_l'), region('trunk')]
  const wrist = f.pos[skel.seg.hand_l]
  const bell = { ...spec, parts: spec.parts.slice(0, 6) }
  let best: { e: number; pos: V3; rot: Quat; site: string } | null = null
  for (const corner of ['corner_l', 'corner_r']) {
    const s = spec.sites[corner]
    for (const sign of [1, -1]) {
      const base = alignAxis(scale(s.axis!, sign), h.axis)
      const at = (a: number) => {
        const rot = qmul(qaxis(h.axis, a * DEG), base)
        return { rot, pos: sub(h.pos, qrot(rot, s.pos)) }
      }
      for (let a = 0; a < 360; a += 3) {
        const p = at(a)
        const centre = p.pos
        const parts = placeParts(bell, { id: spec.id, ...p })
        const gap = (cs: typeof caps) => Math.min(...parts.flatMap((sd) => cs.map((c) => capsuleSolidClearance(c, sd))))
        const ha = gap(hand), fa = gap(forearm), ua = gap(upperarm), tr = gap(chest)
        // resting on the forearm and the biceps (sunk no deeper than `sink`, nor into the hand), clear of the chest; lateral of the wrist
        // (the left hand: +X, set up standing), not in front of it (+Z) and no higher than the hand
        const e =
          4 * (Math.max(0, -ha - KB_RACK.sink) + Math.max(0, -fa - KB_RACK.sink) + Math.max(0, -ua - KB_RACK.sink) + Math.max(0, -tr)) +
          Math.abs(Math.min(fa, ua) + KB_RACK.sink) +
          2 * Math.max(0, KB_RACK.side - (centre[0] - wrist[0])) +
          2 * Math.max(0, centre[2] - wrist[2]) +
          2 * Math.max(0, centre[1] - h.pos[1] - 0.02)
        if (!best || e < best.e) best = { e, ...p, site: corner }
      }
    }
  }
  const inv = qconj(h.rot)
  return { pos: qrot(inv, sub(best!.pos, h.pos)), rot: qmul(inv, best!.rot), site: best!.site }
}

/** rotation taking unit vector a onto unit vector b */
function alignAxis(a: V3, b: V3): Quat {
  const c = cross(a, b)
  const s = Math.hypot(...c), d = dot(a, b)
  if (s < 1e-9) return d > 0 ? qid() : qaxis(Math.abs(a[0]) < 0.9 ? norm(cross(a, [1, 0, 0])) : norm(cross(a, [0, 1, 0])), Math.PI)
  return qaxis(scale(c, 1 / s), Math.atan2(s, d))
}

const mirrorV = (v: V3): V3 => [-v[0], v[1], v[2]]
const mirrorQ = (r: Quat): Quat => [r[0], -r[1], -r[2], r[3]]

/** both rack bells in the world from the hands */
export function kbRackPoses(skel: Skeleton, f: FK, inHand: { pos: V3; rot: Quat }): ImplementPose[] {
  return (['l', 'r'] as Side[]).map((side) => {
    const h = handFrame(skel, f, side)
    const rel = side === 'l' ? inHand : { pos: mirrorV(inHand.pos), rot: mirrorQ(inHand.rot) }
    return { id: `kb_${side}`, pos: add(h.pos, qrot(h.rot, rel.pos)), rot: qmul(h.rot, rel.rot) }
  })
}

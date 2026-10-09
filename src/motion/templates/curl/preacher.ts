import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { attachHand, handFrame, implementFromHand, plantFoot, root1d, solveLegs, type FootTarget } from '../../constraints.ts'
import { fk, segPos, sitePos } from '../../fk.ts'
import { dumbbell, ezBar, siteWorld, type ImplementSpec } from '../../implements.ts'
import { preacherBench, preacherFrame } from '../../implements/stations.ts'
import { dls } from '../../ik.ts'
import { add, clamp, cross, DEG, dot, lerp, qaxis, qconj, qrot, RAD, scale, sub, type V3 } from '../../math.ts'
import { setDofs, setScapula, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { footContacts } from '../isolation.ts'
import type { ParamsOf } from '../schemas.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'

// Preacher curl (720 EZ bar, 721 one dumbbell, 728 EZ bar palms down): seated on the preacher bench, the trunk
// leaning a little onto the top of the arm pad, the backs of the upper arms flat on the pad, which slopes down and
// away at 45 deg. The upper arms stay on the pad; only the elbows move, from almost straight (~15 deg, the pad
// takes the stretch, cue 3) to the forearms close to vertical (~120 deg; vertical would be 135 on a 45 deg pad).
// The bench is fitted to the body: the pad's surface under the upper arms, its top edge as close to the armpits as
// the chest allows, the seat under the buttocks. Joint ranges are coaching standard (the elbow range of the
// standing curl with the shoulder fixed in ~45 deg of flexion by the pad).

type P = ParamsOf<'curl'>
type S = 'l' | 'r'

export const PRE = {
  /** pad angle above horizontal, deg (the station default) */
  padAngle: 45,
  /** pelvis tilt and spine flexion: the trunk leans ~20 deg forward onto the pad's top end */
  tilt: 8,
  lumbar: 6,
  thorax: 8,
  neck: -10,
  head: -6,
  hip: [0, 0.7, 0] as V3,
  /** feet: half spacing (either side of the pad column), ahead of the hips, toe-out */
  feet: { x: 0.21, z: 0.4, toeOut: 12 },
  /** upper arms, buttocks and chest sink this far into the pads, m */
  sink: 0.005,
  elbow: [15, 120] as const,
  /** upper arms turned about the pad normal (negative: elbows in, the whole upper arm on the pad), deg: dumbbell, EZ bar */
  abd: { dumbbell: -5, bar: -5 },
  kg: 12,
  barPlate: 5,
  /** EZ bar palms up: forearms supinated; dumbbell: full supination; palms down: pronated */
  pro: -80,
  pronated: 70,
  /** bar hold: reference humeral twist (deg); residual weights (grip error in m, axis cross, then deg per unit) */
  barHold: { rot: 0, w: { pos: 300, axis: 20, rot: 4, pro: 15, wrist: 12, pitch: 90 } },
  /** the free hand (one dumbbell): this far down the pad from its top edge and out from the midline, the grip site this far above the surface, m */
  freeHand: { along: 0.2, x: 0.08, above: 0.04 },
}

export type Preacher = {
  tempo: Tempo
  setup: Setup
  /** working side (both for the bar) */
  work: S[]
  feet: FootTarget[]
  /** world humerus direction of the left arm (the right mirrors) */
  dir: { l: V3; r: V3 }
  bench: ImplementPose
  db?: ImplementSpec
  bar?: { spec: ImplementSpec; sites: [string, string] }
  /** the free arm (one dumbbell): its still DOFs */
  free?: { side: S; q: Float64Array }
  /** reference forearm rotation, deg */
  pro: number
}

function trunk(skel: Skeleton, feet?: FootTarget[]) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': PRE.lumbar, 'thorax.flex': PRE.thorax, 'neck.flex': PRE.neck, 'head.flex': PRE.head, 'clavicle_*.prot': 2, 'grip_*.close': 1 })
  setPelvis(skel, q, PRE.hip, PRE.tilt)
  if (feet) solveLegs(skel, q, feet)
  return q
}

/** one arm with its humerus along world `dir` (no humeral twist), the elbow at e, the forearm turned to `pro` */
function arm(skel: Skeleton, q: Float64Array, s: S, dir: V3, e: number, pro: number) {
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  const d = qrot(qconj(thorax), dir)
  const m: V3 = s === 'l' ? d : [-d[0], d[1], d[2]]
  const elev = Math.acos(clamp(-m[1], -1, 1)) * RAD
  setDofs(skel, q, {
    [`shoulder_${s}.plane`]: Math.atan2(m[2], m[0]) * RAD,
    [`shoulder_${s}.elev`]: elev,
    [`shoulder_${s}.rot`]: 0,
    [`elbow_${s}.flex`]: e,
    [`forearm_${s}.pro`]: pro,
    [`wrist_${s}.flex`]: 0,
    [`wrist_${s}.dev`]: 0,
    [`grip_${s}.close`]: 1,
  })
  setScapula(skel, q, s)
}

const ARM = ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev', 'grip_*.close']

/** EZ bar: palms up on the inner bends at the grip width, palms down on the inner ends of the outer bends (as the standing curls) */
function barOf(p: P, skel: Skeleton): NonNullable<Preacher['bar']> {
  const g = (p.gripWidth * skel.data.shoulderWidth) / 2
  if (p.grip !== 'pronated') return { spec: ezBar({ plateKg: PRE.barPlate, inner: g }), sites: ['l_in', 'r_in'] }
  // the inner bends a little narrower than the default bar so the outer bends sit under the hands of the tucked elbows
  const inner = 0.19
  const base = ezBar({ plateKg: PRE.barPlate, inner })
  const x = inner + 0.065
  const z = 0.03 * (1 - (x - inner - 0.05) / 0.1)
  return { spec: { ...base, sites: { ...base.sites, lp: { pos: [x, 0, z], axis: base.sites.l.axis }, rp: { pos: [-x, 0, z], axis: base.sites.r.axis } } }, sites: ['lp', 'rp'] }
}

/** bar pose with its grips' midpoint on `center`, its camber turned with the forearms (`pitch`: the forearm's angle from hanging, deg) */
function barPose(bar: NonNullable<Preacher['bar']>, center: V3, pitch: number): ImplementPose {
  const rot = qaxis([1, 0, 0], -pitch * DEG)
  const mid = scale(add(bar.spec.sites[bar.sites[0]].pos, bar.spec.sites[bar.sites[1]].pos), 0.5)
  return { id: bar.spec.id, pos: sub(center, qrot(rot, mid)), rot }
}

/**
 * bar: both humeri pinned on the pad (plane and elevation fixed, only a little twist), the elbow on its path, then
 * the forearm turn, the wrist and the bar's height and roll solved so the left hand holds its grip (right mirrored)
 */
function barArms(skel: Skeleton, q: Float64Array, v: Pick<Preacher, 'bar' | 'dir'>, e: number, pro: number): ImplementPose {
  const bar = v.bar!
  arm(skel, q, 'l', v.dir.l, e, pro)
  arm(skel, q, 'r', v.dir.r, e, pro)
  const f0 = fk(skel, q)
  const g0 = sitePos(skel, f0, 'grip_l')
  const fore = sub(segPos(skel, f0, 'hand_l'), segPos(skel, f0, 'forearm_l'))
  const pitch0 = Math.atan2(fore[2], -fore[1]) * RAD
  const idx = ['shoulder_l.rot', 'forearm_l.pro', 'wrist_l.flex', 'wrist_l.dev'].map((n) => skel.dof[n])
  const lim = idx.map((i) => [skel.dofs[i].min, skel.dofs[i].max])
  const { rot, w } = PRE.barHold
  const at = (x: number[]) => {
    for (let i = 0; i < 4; i++) q[idx[i]] = x[i]
    const pose = barPose(bar, [0, x[4], x[5]], x[6])
    return { pose, site: siteWorld(bar.spec, pose, bar.sites[0]) }
  }
  const residual = (x: number[]) => {
    const { site } = at(x)
    const f = fk(skel, q)
    const c = cross(handFrame(skel, f, 'l').axis, site.axis!)
    const d = sub(sitePos(skel, f, 'grip_l'), site.pos)
    return [...scale(d, w.pos), ...scale(c, w.axis), (x[0] - rot) / w.rot, (x[1] - pro) / w.pro, x[2] / w.wrist, x[3] / w.wrist, (x[6] - pitch0) / w.pitch]
  }
  const lo = [...lim.map((l) => l[0]), -Infinity, -Infinity, -Infinity]
  const hi = [...lim.map((l) => l[1]), Infinity, Infinity, Infinity]
  const { x } = dls(residual, [rot, pro, 0, 0, g0[1], g0[2], pitch0], { lo, hi, iters: 40, h: 1e-6 })
  const { pose } = at(x)
  for (const k of ARM) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
  return pose
}

export function preacherContext(p: P, skel: Skeleton, tempo: Tempo): Preacher {
  const { x, z, toeOut } = PRE.feet
  const feet = [plantFoot(skel, 'l', [x, 0, PRE.hip[2] + z], toeOut), plantFoot(skel, 'r', [-x, 0, PRE.hip[2] + z], toeOut)]
  const q0 = trunk(skel, feet)
  const { along, normal } = preacherFrame(PRE.padAngle)
  const db = p.implement === 'dumbbell'
  const abd = (db ? PRE.abd.dumbbell : PRE.abd.bar) * DEG
  // upper arms in the pad's plane, turned out about its normal
  const dir = { l: qrot(qaxis(normal, abd), along), r: qrot(qaxis(normal, -abd), along) }
  const unilateral = db && p.laterality !== 'bilateral'
  const work: S[] = unilateral ? [p.side === 'left' ? 'l' : 'r'] : ['l', 'r']
  // the pad's surface: under the backs of the upper arms (straight arms), sunk `sink`
  const qa = Float64Array.from(q0)
  for (const s of ['l', 'r'] as const) arm(skel, qa, s, dir[s], PRE.elbow[0], PRE.pro)
  const fa = fk(skel, qa)
  const caps = bodyCapsules(skel, fa)
  const sh = segPos(skel, fa, `humerus_${work[0]}`)
  const backOf = (regions: string[]) => Math.min(...caps.filter((k) => regions.includes(k.region)).flatMap((k) => [k.a, k.b].map((e) => dot(e, normal) - k.r)))
  let surface = backOf(work.map((s) => `upperarm_${s}`)) + PRE.sink
  // the pad's top edge on that surface, `t` m along the pad from the shoulder joint; the chest rests on its end
  const topAt = (t: number): V3 => {
    const a = dot(sh, along) + t
    return [0, normal[1] * surface + along[1] * a, normal[2] * surface + along[2] * a]
  }
  const seatTop = Math.min(...caps.filter((k) => k.region === 'trunk').map((k) => Math.min(k.a[1], k.b[1]) - k.r)) + PRE.sink
  const seatZ = PRE.hip[2] - 0.02
  const benchAt = (t: number) => {
    const top = topAt(t)
    const spec = preacherBench({ padAngle: PRE.padAngle, padTop: top[1], seatHeight: seatTop, seatBack: top[2] - seatZ })
    return { spec, pose: { id: spec.id, pos: [0, 0, top[2]] as V3, rot: [0, 0, 0, 1] as [number, number, number, number] } }
  }
  const trunkCaps = caps.filter((k) => k.region === 'trunk')
  const chestGap = (t: number) => {
    const { spec, pose } = benchAt(t)
    const pad = placeParts(spec, pose)[0]
    return Math.min(...trunkCaps.map((k) => capsuleSolidClearance(k, pad))) + PRE.sink
  }
  const fit = () => {
    const t = chestGap(-0.1) >= 0 ? -0.1 : root1d(chestGap, -0.1, 0.2, { tol: 1e-5 }).x
    return benchAt(t)
  }
  const contacts: Contact[] = footContacts(skel, feet)
  const implements_: ImplementSpec[] = []
  const pro = p.grip === 'pronated' ? PRE.pronated : PRE.pro
  let { spec: benchSpec, pose: bench } = fit()
  const v: Preacher = { tempo, setup: undefined as unknown as Setup, work, feet, dir, bench, pro }
  if (db) {
    const s = work[0]
    v.db = dumbbell({ id: `db_${s}`, mass: PRE.kg })
    implements_.push(v.db)
    contacts.push({ site: `grip_${s}`, kind: 'grip', target: { implement: v.db.id, grip: 'c' } })
  } else {
    v.bar = barOf(p, skel)
    implements_.push(v.bar.spec)
    contacts.push(
      { site: 'grip_l', kind: 'grip', target: { implement: v.bar.spec.id, grip: v.bar.sites[0] } },
      { site: 'grip_r', kind: 'grip', target: { implement: v.bar.spec.id, grip: v.bar.sites[1] } },
    )
  }
  if (v.bar) {
    // the pad under the deepest frame of the bar hold, so the arms sink at most `sink` over the rep
    const armCaps = (q: Float64Array) => bodyCapsules(skel, fk(skel, q)).filter((k) => k.region.startsWith('upperarm_'))
    const pad = placeParts(benchSpec, bench)[0]
    let gap = Infinity
    for (let i = 0; i <= 12; i++) gap = Math.min(gap, ...armCaps(frame(skel, v, i / 12).q).map((k) => capsuleSolidClearance(k, pad)))
    surface += Math.min(0, gap + PRE.sink)
    ;({ spec: benchSpec, pose: bench } = fit())
    v.bench = bench
  }
  if (unilateral) {
    // the free hand rests flat on the pad in front of the chest, fingers across towards the working arm
    const free: S = work[0] === 'l' ? 'r' : 'l'
    const top = siteWorld(benchSpec, bench, 'top').pos
    const handAt = add(add(top, scale(along, PRE.freeHand.along)), [(free === 'l' ? 1 : -1) * PRE.freeHand.x, 0, 0])
    const fq = Float64Array.from(q0)
    const target = add(handAt, scale(normal, PRE.freeHand.above))
    attachHand(skel, fq, free, { pos: target, axis: along, palm: scale(normal, -1) }, { pole: [free === 'l' ? 1 : -1, -0.3, 0.2], planeHint: 60 })
    setDofs(skel, fq, { [`grip_${free}.close`]: 0 })
    v.free = { side: free, q: fq }
    // no grip contact: the hand lies open on the pad (a contact would close the drawn fingers round a handle)
  }
  implements_.push(benchSpec)
  const armRegions = ['l', 'r'].flatMap((s) => [`upperarm_${s}`, ...(v.free?.side === s ? [`forearm_${s}`, `hand_${s}`] : [])])
  v.setup = {
    implements: implements_,
    contacts,
    tempo,
    symmetric: !unilateral,
    rests: [{ implement: benchSpec.id, regions: [...armRegions, 'trunk'], tol: 8 }],
  }
  return v
}

function frame(skel: Skeleton, v: Preacher, c: number) {
  const q = trunk(skel, v.feet)
  const e = lerp(PRE.elbow[0], PRE.elbow[1], c)
  if (v.bar) return { q, implements: [barArms(skel, q, v, e, v.pro), v.bench] }
  const s = v.work[0]
  arm(skel, q, s, v.dir[s], e, v.pro)
  if (v.free) for (const k of ARM) q[skel.dof[k.replace('*', v.free.side)]] = v.free.q[skel.dof[k.replace('*', v.free.side)]]
  const h = handFrame(skel, fk(skel, q), s)
  return { q, implements: [{ id: v.db!.id, pos: h.pos, rot: implementFromHand(h.axis, h.palm) }, v.bench] }
}

export function samplePreacher(u: number, skel: Skeleton, v: Preacher): Pose {
  const { q, implements: impl } = frame(skel, v, phaseAt(u, v.tempo).c)
  return { q, implements: impl, contacts: v.setup.contacts }
}

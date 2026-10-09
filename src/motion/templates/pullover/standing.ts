import { attachHand, root1d } from '../../constraints.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { fk } from '../../fk.ts'
import { cableHandle, type Cable, type ImplementSpec } from '../../implements.ts'
import { band, bandAnchor, bandPose } from '../../implements/index.ts'
import { add, DEG, norm, qaxis, qid, qrot, scale, sub, type V3 } from '../../math.ts'
import { setDofs, shoulderRhythm, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { fistContacts, fistGrips, fistId, fistPoses } from '../band-pose.ts'
import { mirrorArm, monotoneCubic, shoulderMid } from '../row/common.ts'
import { trunkAngle } from '../row/bent.ts'
import type { ParamsOf } from '../schemas.ts'
import { makeStance, plantedContacts, stand, stanceWidth, standBalanced, type StanceSetup, type Sway } from '../standing.ts'
import { stackSpec } from '../triceps/rope.ts'
import { cablePressure, HIGH } from '../triceps/pushdown.ts'
import { cyl, frameY } from '../triceps/common.ts'
import type { Setup } from '../types.ts'

// Straight-arm pulldown standing (325 cable straight bar, 327 band): hips hinged to torsoAngle (15) with soft knees, a
// neutral spine, all held still. The arms stay nearly straight (elbowAngle 10, fixed) and sweep in the sagittal plane
// from the stretch (shoulder flexion ~125 against the trunk: the hands at about eye level) down to the thighs (~15),
// pure shoulder extension driven by the lats (research: straight-arm pulldown shoulder flexion ~90-130 -> ~0-20, elbow
// held 5-15). The scapulae follow the scapulohumeral rhythm and depress a little at the finish. The load path is an
// arc about the shoulders; the ankles keep body, load and the cable's pull over the midfoot.

type P = ParamsOf<'pullover'>

export const STAND = {
  knee: 15,
  /** shoulder flexion against the trunk at the stretch, deg (cue: arms out in front at head height) */
  top: 125,
  /** bar or fists this far off the thighs at the finish, m */
  thighClear: 0.012,
  /** scapular depression at the finish, deg of clavicle elevation */
  depress: -5,
}
/**
 * pulley (cable) or band anchor ahead of the midfoot, m: close enough that the cable pulls steeply down from above at
 * the stretch (a near-level pull at head height would tip the lifter forward), far enough to clear the face at the finish
 */
const PULLEY_Z = { cable: 0.85, band: 1.0 }
/** stack load, kg: straight-arm work is done light */
const KG = 10
/** band: anchor height on the wall, each half's pull (kg) */
const BAND_ANCHOR = { y: 2.0, kg: 3 }
/** balance band, m: the cable holds the arms up, so the centre of pressure swings inside the foot (as the pushdowns) */
const TOL = 0.05
/** the balance band's centre stays this close to the midfoot, m */
const MID_BAND = 0.03

export type Standing = {
  kind: 'standing'
  tempo: Tempo
  setup: Setup
  stance: StanceSetup
  tilt: number
  pulley: V3
  /** shoulder flexion against the trunk at the stretch and at the finish, deg */
  range: [number, number]
  /** shoulder midpoint to load centre by flexion, m (holds the elbows at elbowAngle) */
  r: (flex: number) => number
  bar?: ImplementSpec
  anchor?: ImplementPose
  /** centre of the balance band, m ahead of the midfoot */
  target: number
  sway?: Sway
}

function bar(p: P, skel: Skeleton): ImplementSpec {
  const base = cableHandle({ id: 'handle', attachment: 'straight_bar' })
  const g = (p.gripWidth * skel.data.shoulderWidth) / 2
  const w = Math.max(0.25, g + 0.07)
  return { ...base, parts: [cyl([0, 0, 0], [0, -0.05, 0], 0.01), cyl([-w, -0.05, 0], [w, -0.05, 0], 0.014)], sites: { l: { pos: [g, -0.05, 0], axis: [1, 0, 0] }, r: { pos: [-g, -0.05, 0], axis: [1, 0, 0] } } }
}

function trunk(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'lumbar.flex': 2, 'thorax.flex': 3, 'neck.flex': -8, 'head.flex': -4, 'grip_*.close': 1 })
}

/** sagittal directions in the thorax frame: the arm at flexion `flex` and the way it travels as flexion grows */
function arc(skel: Skeleton, q: Float64Array, flex: number) {
  const rot = fk(skel, q).rot[skel.seg.thorax2]
  const down = qrot(rot, [0, -1, 0]), fwd = qrot(rot, [0, 0, 1])
  const a = flex * DEG
  return { dir: add(scale(down, Math.cos(a)), scale(fwd, Math.sin(a))), ahead: add(scale(down, -Math.sin(a)), scale(fwd, Math.cos(a))) }
}

/** the load centre (bar sites' midpoint or between the fists) for flexion `flex` at distance r */
function center(skel: Skeleton, q: Float64Array, flex: number, r: number): V3 {
  return add(shoulderMid(skel, q), scale(arc(skel, q, flex).dir, r))
}

function barPose(spec: ImplementSpec, c: V3, pulley: V3): ImplementPose {
  const rot = frameY(norm(sub(pulley, c)))
  const mid = scale(add(spec.sites.l.pos, spec.sites.r.pos), 0.5)
  return { id: spec.id, pos: sub(c, qrot(rot, mid)), rot }
}

/** girdle and both arms at flexion `flex` with the load centre at distance r */
function arms(skel: Skeleton, q: Float64Array, p: P, v: Pick<Standing, 'bar' | 'pulley' | 'range'>, flex: number, r: number): ImplementPose | undefined {
  const g = shoulderRhythm(flex, 90)
  const t = (v.range[0] - flex) / (v.range[0] - v.range[1])
  // the girdle is set before the load is placed off the shoulders, so the reach does not depend on the last solve
  setDofs(skel, q, { 'clavicle_*.elev': g.elev + STAND.depress * Math.max(0, Math.min(1, t)), 'clavicle_*.prot': g.prot, 'scapula_*.uprot': g.uprot })
  const c = center(skel, q, flex, r)
  const { ahead } = arc(skel, q, flex)
  const pose = v.bar ? barPose(v.bar, c, v.pulley) : undefined
  const hand = pose ? add(pose.pos, qrot(pose.rot, v.bar!.sites.l.pos)) : add(c, [(p.gripWidth * skel.data.shoulderWidth) / 2, 0, 0])
  // pronated: the palms face the way the arms sweep down (the thighs at the finish, the floor with the arms level);
  // the soft elbows point out to the sides and a little up the arc
  const pole = norm(add([1, 0, 0], scale(ahead, -0.4)))
  attachHand(skel, q, 'l', { pos: hand, axis: [1, 0, 0], palm: scale(ahead, -1) }, { pole, planeHint: 90, uprot: g.uprot })
  mirrorArm(skel, q)
  return pose
}

function base(skel: Skeleton, v: Pick<Standing, 'stance' | 'tilt'>) {
  const q = zeroQ(skel)
  trunk(skel, q)
  stand(skel, q, v.stance, { knee: STAND.knee, df: 8, tilt: v.tilt })
  return q
}

/** the loads and pulls on the hands: the cable at the bar's rod, or each band half at its fist */
function pressure(skel: Skeleton, q: Float64Array, v: Standing, pose?: ImplementPose) {
  const f = fk(skel, q)
  if (pose) {
    const c = scale(add(add(pose.pos, qrot(pose.rot, v.bar!.sites.l.pos)), add(pose.pos, qrot(pose.rot, v.bar!.sites.r.pos))), 0.5)
    return cablePressure(skel, f, add(c, scale(norm(sub(v.pulley, c)), 0.05)), v.pulley, 0.5, KG)
  }
  const fists = fistPoses(skel, q)
  return cablePressure(skel, f, scale(add(fists[0].pos, fists[1].pos), 0.5), v.pulley, 0, BAND_ANCHOR.kg * 2)
}

function frame(skel: Skeleton, p: P, v: Standing, c: number, sway = v.sway) {
  const flex = v.range[0] + (v.range[1] - v.range[0]) * c
  const r = v.r(flex)
  const q = zeroQ(skel)
  trunk(skel, q)
  let pose: ImplementPose | undefined
  const bal = standBalanced(skel, q, v.stance, { knee: STAND.knee, tilt: v.tilt }, (qq) => pressure(skel, qq, v, pose) - v.target, (qq) => {
    pose = arms(skel, qq, p, v, flex, r)
  }, [-15, 30], sway)
  return { q, pose, bal }
}

export function standingContext(p: P, skel: Skeleton, tempo: Tempo): Standing {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const tilt = root1d((t) => {
    const q = zeroQ(skel)
    trunk(skel, q)
    stand(skel, q, stance, { knee: STAND.knee, df: 8, tilt: t })
    return trunkAngle(skel, q) - p.torsoAngle
  }, -10, 60, { tol: 1e-5 }).x
  const cable = p.implement === 'cable'
  const pulley: V3 = [0, cable ? HIGH : BAND_ANCHOR.y, stance.midfoot[2] + (cable ? PULLEY_Z.cable : PULLEY_Z.band)]
  const contacts: Contact[] = plantedContacts(skel, stance)
  const implements_: ImplementSpec[] = []
  let cables: Cable[]
  let spec: ImplementSpec | undefined
  let anchor: ImplementPose | undefined
  if (cable) {
    spec = bar(p, skel)
    implements_.push(spec, stackSpec(pulley, false))
    contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: spec.id, grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: spec.id, grip: 'r' } })
    cables = [{ pulley, implement: spec.id, point: [0, 0, 0], kg: KG }]
  } else {
    // a wall anchor above head height facing the lifter, the band looped through it, an end bunched in each fist
    const a = bandAnchor({ height: BAND_ANCHOR.y, mount: 'wall' })
    const rot = qaxis([0, 1, 0], Math.PI)
    anchor = { id: a.id, pos: sub(pulley, qrot(rot, a.sites.hook.pos)), rot }
    const strip = band({ path: [{ implement: fistId('l'), site: 'a' }, { implement: fistId('l'), site: 'b' }, { implement: a.id, site: 'hook' }, { implement: fistId('r'), site: 'b' }, { implement: fistId('r'), site: 'a' }], size: 'medium' })
    implements_.push(...fistGrips(), a, strip)
    contacts.push(...fistContacts())
    cables = (['l', 'r'] as const).map((s) => ({ pulley, implement: fistId(s), point: [0, 0, 0] as V3, kg: BAND_ANCHOR.kg }))
  }
  const held = spec ? [spec.id] : [fistId('l'), fistId('r')]
  const setup: Setup = {
    implements: implements_,
    contacts,
    tempo,
    symmetric: true,
    cables,
    balance: { point: 'com', over: 'midfoot', tol: TOL },
    rests: held.map((implement) => ({ implement, regions: ['thigh_l', 'thigh_r'], tol: -STAND.thighClear * 1000 + 2 })),
  }
  const v: Standing = { kind: 'standing', tempo, setup, stance, tilt, pulley, range: [p.topElevation ?? STAND.top, 15], r: () => 0.6, bar: spec, anchor, target: 0 }
  // the load's distance from the shoulders that holds the elbows at elbowAngle, solved along the arc
  const q0 = base(skel, v)
  const elbowAt = (flex: number, r: number) => {
    const q = Float64Array.from(q0)
    arms(skel, q, p, v, flex, r)
    return q[skel.dof['elbow_l.flex']]
  }
  const fs = Array.from({ length: 13 }, (_, k) => -5 + (k * (v.range[0] + 10)) / 12)
  const rs = fs.map((fl) => root1d((r) => elbowAt(fl, r) - p.elbowAngle, 0.3, 0.9, { tol: 1e-6 }).x)
  v.r = monotoneCubic(fs, rs)
  // finish: sweeping down from the front, the first flexion where the bar or the fists (and the hands) come within
  // thighClear of the thighs
  const gap = (flex: number) => {
    const q = Float64Array.from(q0)
    const pose = arms(skel, q, p, v, flex, v.r(flex))
    const caps = bodyCapsules(skel, fk(skel, q))
    const thighs = caps.filter((c) => c.region.startsWith('thigh_'))
    const hands = caps.filter((c) => c.region.startsWith('hand_'))
    const solids = pose ? placeParts(v.bar!, pose) : fistPoses(skel, q).flatMap((fp, i) => placeParts(implements_[i], fp))
    let m = Infinity
    for (const c of thighs) {
      for (const sd of solids) m = Math.min(m, capsuleSolidClearance(c, sd))
      for (const h of hands) m = Math.min(m, capsuleClearance(c, h))
    }
    return m - STAND.thighClear
  }
  let hi = 60
  while (hi > 0 && gap(hi - 2) > 0) hi -= 2
  v.range[1] = hi > 0 ? root1d(gap, hi - 2, hi, { tol: 1e-4 }).x : 0
  // the ankles held still at the angle with the smallest centre of pressure swing about a point near the midfoot
  // (within MID_BAND), the balance band centred there: a lifter takes the swing inside the foot instead of rocking
  const offsAt = (df: number) => Array.from({ length: 32 }, (_, i) => frame(skel, p, v, phaseAt(i / 32, tempo).c, { ref: df, follow: 0 }).bal.offset)
  const centre = (o: number[]) => Math.max(-MID_BAND, Math.min(MID_BAND, (Math.max(...o) + Math.min(...o)) / 2))
  const cost = (o: number[]) => Math.max(...o.map((x) => Math.abs(x - centre(o))))
  let best = { df: 8, offs: offsAt(8) }
  for (let df = -4; df <= 30; df += 1) {
    const offs = offsAt(df)
    if (cost(offs) < cost(best.offs)) best = { df, offs }
  }
  v.target = Math.round(centre(best.offs) * 1000) / 1000
  setup.balance!.target = v.target
  v.sway = { ref: best.df, follow: 0 }
  return v
}

export function sampleStanding(u: number, p: P, skel: Skeleton, v: Standing): Pose {
  const { q, pose } = frame(skel, p, v, phaseAt(u, v.tempo).c)
  const extra: ImplementPose[] = pose ? [pose, { id: 'stack', pos: [0, 0, 0], rot: qid() }] : [...fistPoses(skel, q), v.anchor!, bandPose()]
  return { q, implements: extra, contacts: v.setup.contacts }
}

import { plantFoot, root1d, solveLegs, type FootTarget } from '../../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { fk } from '../../fk.ts'
import { siteWorld, type ImplementSpec } from '../../implements.ts'
import { leverPose, tbarLever, tbarStation, TBAR } from '../../implements/index.ts'
import { tbarFrame } from '../../implements/stations.ts'
import { dls } from '../../ik.ts'
import { dot, lerp, qid, sub, type Quat, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { footContacts } from '../triceps/common.ts'
import { BOTTOM_ELBOW, trunkAngle } from './bent.ts'
import { handOn, handSchedule } from './hand.ts'
import { ARM_DOFS, elbowPole, ELBOW_LAG, gripContacts, lerp as slerp, mirrorArm, monotoneCubic, phases, PROT, reach, scapularLead, shoulderMid, type P } from './common.ts'

// Chest-supported T-bar row (338 close neutral handles, 339 wide pronated ends) on the T-bar station: the chest on the
// inclined pad (40 deg), feet on the platform behind with soft knees, body still. The arms hang to the lever's handles
// with the shoulders protracted (elbows ~8 deg), then the scapulae set back and the elbows drive the lever up about its
// pivot until the elbows pass the trunk (elbow ~8 -> ~115 deg; close grip elbows tucked ~30, wide flared ~70, the upper
// back's row). The chest stays on the pad.

/** chest sink into the pad, m */
const SINK = 0.012
/** shoulder joints this far up the pad's line past its top end, m: the arms hang clear of the pad */
const SHOULDER_PAST = 0.12
const KNEE = 25
/** ankle dorsiflexion on the platform, deg: the shins lean a little into the pad */
const ANKLE = 35
const FEET_X = 0.13
/** lever parts and hands stop this far off the pad and the body at the top, m */
const TOP_GAP = 0.012
const TOP_ELBOW = 115
/** when the lever's arc passes the elbows' most bent point first, the top stops this far short of it, deg */
const PEAK_BACKOFF = 3
/** close grip: upper arm against the ribs, mm (the default trunk / upper arm allowance is 20) */
const TUCK_TOL = 30
/** close neutral grip: the handle crosses the palm this far off the grip line, deg, which keeps the wrist off its deviation stop */
const NEUTRAL_OBLIQUE = 5
/** close neutral grip: comfortable wrist deviation band, deg (ulnar deviation passes ~30 mid-pull) */
const NEUTRAL_DEV: [number, number] = [-34, 25]
/** chest pad length, m: the sternum's length, so the belly, hips and thighs clear its lower end */
const PAD_LEN = 0.32
/**
 * chest pad width by grip, m: narrow enough for the tucked upper arms and, with the close neutral handles (0.22 m apart),
 * the forearms to pass its edges as the handles come up beside it
 */
const PAD_WIDTH = { neutral: 0.14, wide: 0.22 }
/**
 * the lever's handles this far ahead of the pad's top end (frame z), m: a little behind it, beside the pad, so the hands
 * come up to the lower chest and the elbows pass the trunk (ahead of the top end the hands stay in front of the shoulders
 * and the elbows stop ~75-85, in front of the trunk). Further back the close hands meet the pad's frame
 */
const HANDLE_AHEAD = -0.1
/** lever pivot (frame), further forward than the default so the handles' arc stays near vertical under the shoulders */
const PIVOT: V3 = [0, 0.3, 1.7]

export type Tbar = {
  kind: 'tbar'
  tempo: Tempo
  setup: Setup
  hip: V3
  tilt: number
  feet: FootTarget[]
  lever: ImplementSpec
  station: ImplementPose
  /** lever angle at the hang and the top, deg */
  deg: [number, number]
  sites: [string, string]
  /** the left hand's orientation by contraction (smooth) */
  hand?: (c: number) => Quat | undefined
  /** lever angle by contraction, deg */
  angle: (c: number) => number
}

function trunk(skel: Skeleton, q: Float64Array, s: number) {
  setDofs(skel, q, {
    'lumbar.flex': 0,
    'thorax.flex': 4,
    'neck.flex': -12,
    'head.flex': -6,
    'clavicle_*.prot': slerp(PROT.start, PROT.finish, s),
    'clavicle_*.elev': slerp(2, -4, s),
    'grip_*.close': 1,
  })
}

function body(skel: Skeleton, q: Float64Array, v: Pick<Tbar, 'hip' | 'tilt' | 'feet'>, s: number) {
  trunk(skel, q, s)
  setPelvis(skel, q, v.hip, v.tilt)
  if (v.feet.length) solveLegs(skel, q, v.feet)
}

function arms(skel: Skeleton, q: Float64Array, p: P, v: Pick<Tbar, 'lever' | 'sites'>, pose: ImplementPose, hand?: Quat) {
  for (const k of ARM_DOFS) for (const sd of ['l', 'r']) q[skel.dof[k.replace('*', sd)]] = 0
  const g = siteWorld(v.lever, pose, v.sites[0])
  // neutral: palms in, the handles front to back; wide: overhand on the cross bar, palms back towards the feet
  const palm: V3 = p.grip === 'neutral' ? [-1, 0, 0] : [0, -0.3, -1]
  reach(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm, ...(hand ? { hand } : {}) }, { pole: elbowPole(skel, q, 'l', p.elbowFlare, 0.6), planeHint: 90, devBand: p.grip === 'neutral' ? NEUTRAL_DEV : [-28, 25] })
  mirrorArm(skel, q)
}

export function frame(skel: Skeleton, p: P, v: Omit<Tbar, 'kind' | 'tempo' | 'setup' | 'angle'>, s: number, deg: number, hand?: Quat) {
  const q = zeroQ(skel)
  body(skel, q, v, s)
  const pose = leverPose(v.lever.id, PIVOT, deg)
  arms(skel, q, p, v, pose, hand)
  return { q, pose }
}

export function tbarContext(p: P, skel: Skeleton, tempo: Tempo): Tbar {
  const neutral = p.grip === 'neutral'
  const lever = tbarLever({ pivot: PIVOT, handle: [0, TBAR.handle[1], HANDLE_AHEAD] })
  const { along, normal } = tbarFrame()
  const top = TBAR.pad.top
  const sites: [string, string] = p.grip === 'neutral' ? ['neutral_l', 'neutral_r'] : ['wide_l', 'wide_r']
  const v: Omit<Tbar, 'kind' | 'tempo' | 'setup' | 'angle'> = { hip: [0, 0.95, -0.4], tilt: 40, feet: [], lever, station: { id: 'tbar', pos: [0, 0, 0], rot: qid() }, deg: [0, 15], sites }
  // trunk along the pad: hips-to-shoulders at 90 - padAngle from vertical
  const trunkTilt = (t: number) => {
    const q = zeroQ(skel)
    trunk(skel, q, 0)
    setPelvis(skel, q, [0, 1, 0], t)
    return trunkAngle(skel, q) - (90 - TBAR.pad.angle)
  }
  v.tilt = root1d(trunkTilt, 0, 89, { tol: 1e-6 }).x
  // the chest on the pad's plane (sunk SINK) with the shoulder joints SHOULDER_PAST up the line past its top end
  const res = (x: number[]) => {
    const q = zeroQ(skel)
    body(skel, q, { ...v, hip: [0, x[0], x[1]], feet: [] }, 0)
    const f = fk(skel, q)
    const chest = bodyCapsules(skel, f).filter((c) => c.segment === 'thorax2' || c.segment === 'thorax1')
    const plane = Math.min(...chest.map((c) => Math.min(dot(sub(c.a, top), normal), dot(sub(c.b, top), normal)) - c.r))
    return [(plane + SINK) * 100, (dot(sub(shoulderMid(skel, q), top), along) - SHOULDER_PAST) * 100]
  }
  const r = dls(res, [v.hip[1], v.hip[2]], { tol: 1e-8, iters: 80 })
  v.hip = [0, r.x[0], r.x[1]]
  // feet on the platform with soft knees and the shins near vertical: the platform (adjustable on the station) goes
  // where that puts the soles
  const feetAt = (y: number, z: number) => [plantFoot(skel, 'l', [FEET_X, 0, z], 8, y), plantFoot(skel, 'r', [-FEET_X, 0, z], 8, y)]
  const fr = dls((x) => {
    const q = zeroQ(skel)
    body(skel, q, { ...v, feet: feetAt(x[0], x[1]) }, 0)
    return [(q[skel.dof['knee_l.flex']] - KNEE) / 10, (q[skel.dof['ankle_l.df']] - ANKLE) / 10]
  }, [0.3, v.hip[2] - 0.2], { tol: 1e-8, iters: 80 })
  v.feet = feetAt(fr.x[0], fr.x[1])
  const platform: V3 = [0, fr.x[0], fr.x[1] - 0.04]
  const stationSpec = tbarStation({ platform, padLen: PAD_LEN, padWidth: neutral ? PAD_WIDTH.neutral : PAD_WIDTH.wide, pivot: PIVOT })
  // the hands hold one orientation round the handles (the forearms stay near vertical under the elbows): neutral palms
  // in, index fingers forward; wide overhand, palms towards the feet
  const axis = siteWorld(lever, leverPose(lever.id, PIVOT, 10), sites[0]).axis!
  const fixed = p.grip === 'neutral' ? handOn(skel, axis, [0, -1, 0.15], [-1, 0, 0], NEUTRAL_OBLIQUE) : undefined
  let hand = (_c: number): Quat | undefined => fixed
  // hang: the lever angle where the elbows are just short of straight; top: elbows past the trunk or the lever at the pad
  const elbowAt = (deg: number, s: number) => frame(skel, p, v, s, deg, fixed).q[skel.dof['elbow_l.flex']]
  v.deg[0] = root1d((d) => elbowAt(d, 0) - BOTTOM_ELBOW, -30, 50, { tol: 1e-6 }).x
  const pad = placeParts(stationSpec, v.station)[0]
  const gap = (deg: number) => {
    const { q, pose } = frame(skel, p, v, 1, deg, fixed)
    const caps = bodyCapsules(skel, fk(skel, q))
    const body_ = caps.filter((c) => !c.region.startsWith('hand_') && !c.region.startsWith('forearm_'))
    const hands = caps.filter((c) => c.region.startsWith('hand_') || c.region.startsWith('forearm_'))
    let m = Infinity
    for (const sd of placeParts(lever, pose)) for (const c of body_) m = Math.min(m, capsuleSolidClearance(c, sd))
    for (const c of hands) m = Math.min(m, capsuleSolidClearance(c, pad))
    return m - TOP_GAP
  }
  // walk the lever up until the elbows reach TOP_ELBOW, stop bending further, or something comes within TOP_GAP
  let last = v.deg[0], best = elbowAt(last, 1)
  for (let d = v.deg[0] + 0.25; d < 80; d += 0.25) {
    const e = elbowAt(d, 1)
    // retracted, the shoulders sit back off the first part of the arc: walk on until the hands reach the handles
    if (best < 2) {
      ;[last, best] = [d, e]
      continue
    }
    if (e < best - 0.01) {
      // the elbows have passed their most bent point on the arc: finish a little short of it, where the lever still
      // moves steadily with the elbow (at the very peak a small elbow change is a large lever swing)
      const target = best - PEAK_BACKOFF
      last = root1d((dd) => elbowAt(dd, 1) - target, v.deg[0], last, { tol: 1e-6 }).x
      best = target
      break
    }
    if (gap(d) < 0) break
    last = d
    best = e
    if (e >= TOP_ELBOW) break
  }
  v.deg[1] = last
  // the lever angle along the rep: the elbows follow a lagging curve while the scapulae lead (as the inverted row), so
  // the hands never run ahead of what the arms can reach
  const topElbow = best
  const cs = Array.from({ length: 9 }, (_, k) => k / 8)
  const ds = cs.map((c, k) => (k === 0 ? v.deg[0] : k === 8 ? v.deg[1] : root1d((d) => elbowAt(d, scapularLead(c)) - lerp(BOTTOM_ELBOW, topElbow, c ** ELBOW_LAG), v.deg[0] - 2, v.deg[1] + 2, { tol: 1e-6 }).x))
  const angle = monotoneCubic(cs, ds)
  // wide overhand: the bar lies obliquely across the flared hands, so the hand's roll is solved free at knots and smoothed
  if (!fixed) hand = handSchedule(skel, (c) => frame(skel, p, v, scapularLead(c), angle(c)).q)
  // close neutral: the fixed hand as the wrist settles round it at a few knots, smoothed, so the deviation's soft stop
  // eases in (the forearm's pitch against the front-to-back handle is wrist deviation in this grip)
  else hand = handSchedule(skel, (c) => frame(skel, p, v, scapularLead(c), angle(c), fixed).q, 9)

  const contacts: Contact[] = [...footContacts(skel, v.feet), ...gripContacts(lever.id, sites)]
  const setup: Setup = {
    implements: [stationSpec, lever],
    contacts,
    tempo,
    symmetric: true,
    // the chest rests on the pad; the soles on the platform
    rests: [{ implement: stationSpec.id, regions: ['trunk', 'foot_l', 'foot_r'], tol: SINK * 1000 + 10 }],
  }
  // close neutral grip: the tucked upper arms brush the ribs mid-pull (a lead decision, this variant only)
  if (p.grip === 'neutral') setup.tolerances = { body: Object.fromEntries(['trunk / upperarm_l', 'trunk / upperarm_r', 'trunk / upperarm_l (thorax2)', 'trunk / upperarm_r (thorax2)'].map((k) => [k, TUCK_TOL])) }
  return { kind: 'tbar', tempo, setup, ...v, hand, angle }
}

export function sampleTbar(u: number, p: P, skel: Skeleton, v: Tbar): Pose {
  const ph = phases(u, v.tempo)
  const { q, pose } = frame(skel, p, v, ph.s, v.angle(ph.c), v.hand?.(ph.c))
  return { q, implements: [v.station, pose], contacts: v.setup.contacts }
}


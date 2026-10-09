import { attachHand, handFrame, implementFromHand, legKinematics, root1d, writeLeg, type FootTarget } from '../constraints.ts'
import { dls } from '../ik.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts, restAgainst } from '../collide.ts'
import { centerOfMass, fk, localToWorld } from '../fk.ts'
import { barbell, dumbbell, siteWorld, type ImplementSpec, type Part } from '../implements.ts'
import { weightPlate, PLATE } from '../implements/free-weights.ts'
import { plyoBox } from '../implements/shared.ts'
import { add, cross, DEG, dot, lerp, neg, norm, qaxis, qconj, qfromBasis, qid, qmul, qrot, scale, sub, type Quat, type V3 } from '../math.ts'
import { setDofs, setScapula, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, loopDuration, phaseAt, type Tempo } from '../timing.ts'
import type { ParamsOf } from './schemas.ts'
import { SCHEMAS } from './schemas.ts'
import { hipMidLocal, hipsFor, makeStance, plantedContacts, setPelvis, stanceWidth, stand, standBalanced, type StanceName, type StanceSetup } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'
import { kbGoblet, kbGobletArms, kbGobletPose, kbRackArmPairs, kbRackInHand, kbRackPair, kbRackPoses } from './squat/holds.ts'
import { isVariant, variant } from './squat/variants.ts'

// Squat family. Standing variants key knee flexion and ankle dorsiflexion by depth; the hips follow from the planted
// feet (knees bend in the plane of the toes) and the trunk lean is solved each frame so the bar stays over the
// midfoot (free bar), over the rail line (Smith) or, without a bar, the ankles bring the system COM over the midfoot.
// High-bar vs low-bar vs front-rack lean falls out of where the bar sits. The leg press fixes the pelvis to the seat
// and moves the sled along its rail; the legs are solved to the feet on the plate.

type P = ParamsOf<'squat'>

// knee flexion / ankle dorsiflexion at the bottom, deg (Escamilla 2001; Endo 2020; author judgment per hold)
const KNEE: Record<P['depth'], number> = { quarter: 60, parallel: 100, full: 118 }
const ANKLE: Record<string, Record<P['depth'], number>> = {
  back_high: { quarter: 12, parallel: 23, full: 33 },
  back_low: { quarter: 10, parallel: 19, full: 24 },
  front_rack: { quarter: 14, parallel: 24, full: 30 },
  goblet: { quarter: 13, parallel: 23, full: 28 },
  none: { quarter: 12, parallel: 21, full: 25 },
  // feet forward of the rail: shins a bit more vertical than a free squat, not fully, since with the bar fixed on
  // the rail every degree of shin angle given up turns into forward trunk lean
  smith: { quarter: 9, parallel: 17, full: 22 },
  // kettlebells in the front rack: as upright as the barbell front squat, the knees forward
  kb_rack: { quarter: 14, parallel: 24, full: 30 },
  // sumo: wide stance, toes out, the knees travel out over the toes more than forward
  hang: { quarter: 9, parallel: 17, full: 22 },
  // box squat: sit back to the box, shins near vertical; the bar over the midfoot leans the trunk
  box: { quarter: 8, parallel: 20, full: 22 },
  heels: { quarter: 13, parallel: 23, full: 28 },
}
const TOP_KNEE = 3
/** wide, turned-out stance: the knees stay soft at the top (a straighter leg cannot keep the feet flat and turned out) */
const WIDE_TOP_KNEE = 9
const TOP_ANKLE = 5
/** heels on a plate: the trunk stays more upright than the flat goblet squat and the knees travel forward, deg */
const HEELS_TILT = 4
/** trunk (pelvis) lean at the bottom when no bar sets it, deg */
const TILT: Record<string, number> = { goblet: 20, none: 22, kb_rack: 14, hang: 20, heels: HEELS_TILT }
const DB_KG = 24
/**
 * Goblet: the dumbbell stands vertical against the chest, its centre `up` above the sternum and sunk `sink` into it;
 * both palms cup the underside of the top head either side of the handle (dumbbell frame: X up the handle, Y forward,
 * Z to the lifter's left), palms up and in, fingers up round the rim, elbows down.
 */
const GOBLET = { up: 0.05, sink: 0.004, cup: [0.033, 0.03, 0.06] as V3, fingers: [1, 0.8, -0.3] as V3, palm: [1, 0, -0.5] as V3 }
const GOBLET_ROT = implementFromHand([0, 1, 0], [0, 0, 1])
/**
 * Goblet depth: the squat bottoms out where the arms come down onto the thighs, just inside the knees (a light
 * touch, capsule clearance in m, inside the 12 mm arm-thigh soft-tissue tolerance), never deeper than the depth table
 */
const GOBLET_ARMS_ON_THIGHS = -0.006
/** Smith: midfoot ahead of the rail line, m */
const SMITH_FEET: Record<P['footPosition'], number> = { low: 0, mid: 0.06, high: 0.12, forward: 0.16 }
/** front rack grip: the schema default (2.1) is a back-squat width; clean grips sit just outside the shoulders */
const RACK_GRIP = 1.3
/** front rack wrist extension range (motion decision 2026-09-27: real lifters pass the 70 deg default) */
const RACK_WRIST: [number, number] = [-90, 75]
/**
 * Front rack: elbows up and forward (upper arm near horizontal), the bar on the shelf the raised front delts make,
 * clear of the throat, and across the fingers with the wrists extended. The bar goes where the fingers hold it; the
 * arm is solved for the shelf, the throat, the elbow height and the grip width together.
 */
const RACK = {
  /** upper-arm elevation the solve pulls towards, deg */
  elev: 82,
  /** bar sinking into the delts (capsule clearance, m) */
  sink: 0.008,
  /** clearance from the bar to the neck and head, m */
  throat: 0.02,
  /** scapulae protracted and elevated: the shoulders come forward and up under the bar */
  clavicle: { prot: 14, elev: 10 },
}
/** plane, elevation, rotation, elbow, pronation, wrist flexion, deviation */
const RACK_SEEDS = [[75, 80, -20, 145, 40, -80, 0], [85, 85, 0, 148, 60, -85, 5], [70, 75, -40, 140, 20, -75, -5]]
/** body regions a bar rests on, where it may sink into the soft tissue a little */
const BAR_REST: Record<NonNullable<Stand['barSite']>, string[]> = {
  back_high: ['trunk', 'girdle_l', 'girdle_r', 'neck', 'upperarm_l', 'upperarm_r'],
  back_low: ['trunk', 'girdle_l', 'girdle_r', 'upperarm_l', 'upperarm_r'],
  front_rack: ['trunk', 'girdle_l', 'girdle_r', 'upperarm_l', 'upperarm_r'],
}
/** unloaded squat: centre of mass target behind the midfoot, m (towards the heel, trunk more upright) */
const UNLOADED_COM = -0.03
/**
 * Sumo squat: one dumbbell hangs upright between the legs from both hands, one either side of its top head, palms in,
 * the fingers hooked under the head's rim (dumbbell frame: X up the handle, Y forward, Z to the lifter's left; grip
 * axis little finger to index, forward). The hooks' midpoint sits `reach` from the midpoint of the shoulder joints
 * (the arms near straight), as close under them as the thighs allow: at least `ahead` in front, more where the line from a hook to its
 * shoulder would come within `hand` (fist radius and a margin, m) of the thighs. The shoulders protract `prot`; the upper arms may press on
 * the sides of the lower chest (`chest`, mm: the penetration tolerance there, lead decision).
 */
const HANG = { kg: 20, hook: [0.04, 0, 0.12] as V3, axis: [0, 1, 0] as V3, palm: [0.2, 0, -1] as V3, reach: 0.69, ahead: 0, hand: 0.065, prot: 12, chest: 30 }
/** front rack bells: clearance kept from the thighs at the bottom, and the arms' (negative: a light touch), m */
const KB_RACK_THIGH = { bell: 0.004, arm: -0.006 }
/** heel-elevated squat: a 10 kg plate flat under both heels, the heel contacts this far in from its front edge (m) */
const HEEL_PLATE = { kg: 10 as const, inset: 0.05, floorTol: 16 }
/** box squat: box front edge this far ahead of the hip joints at the bottom (m); the glutes sink this far onto the tread */
const BOX = { ahead: 0.1, sink: 0.008 }
/** box squat: a short pause seated on the box (s), otherwise the default tempo (lead decision) */
const BOX_TEMPO: Tempo = [DEFAULT_TEMPO[0], 0.6, DEFAULT_TEMPO[2], DEFAULT_TEMPO[3]]

// leg press: knee flexion at the bottom and the dorsiflexion footPosition sets there (author judgment)
const PRESS_KNEE: Record<P['depth'], number> = { quarter: 50, parallel: 75, full: 92 }
const PRESS_TOP_KNEE = 10
const PRESS_DF: Record<P['footPosition'], number> = { low: 37, mid: 33, high: 24, forward: 24 }
/** stop the sled before the thighs reach the ribs (posterior pelvic tilt is not modelled; the gate caught 128) */
const PRESS_HIP_MAX = 112
/** back pad recline from vertical, deg */
const PRESS_RECLINE = 53
const PRESS_HIP: V3 = [0, 0.62, 0]
/** the drawn leg press's seat pan (props/legpress.ts): surface centre `along` the pan from the hip point and `drop` below it */
const PRESS_SEAT = { along: 0.114, drop: 0.0545, tilt: 25 }
/** single-leg press: working foot this far from the plate centre (m), resting leg pose (deg) */
const PRESS_ONE_X = 0.06
const PRESS_FREE = { flex: 95, abd: 20, knee: 120, df: 10 }

type Stand = {
  kind: 'stand'
  stance: StanceSetup
  holdKey: string
  bar?: ImplementSpec
  barSite?: 'back_high' | 'back_low' | 'front_rack'
  /** bar centre in the thorax2 frame: the site, lifted onto the delts for a front rack */
  barLocal?: V3
  /** Smith rail line (z); the bar stays on it */
  railZ?: number
  /** ankle dorsiflexion at the top; with a bar, whatever puts it over its line with the trunk upright */
  topDf: number
  /** arm DOFs for a bar fixed on the torso: solved once, constant through the rep */
  arms?: [number, number][]
  goblet?: boolean
  /** knee flexion at the bottom when the depth table does not set it (goblet: where the arms meet the thighs) */
  bottomKnee?: number
  /** loads held in front without a bar: kettlebell goblet, two kettlebells in the front rack, a dumbbell hanging */
  held?: { kind: 'kb_goblet' | 'kb_rack' | 'hang'; specs: ImplementSpec[]; arms?: [number, number][]; inHand?: { pos: V3; rot: Quat } }
  /** heels on a plate: foot pitch (deg, heel up) and the plate */
  heels?: { pitch: number; pose: ImplementPose }
  /** box squat: the box under the glutes at the bottom */
  box?: ImplementPose
  /** knee flexion standing tall when TOP_KNEE does not fit the stance */
  topKnee?: number
}

type Press = {
  kind: 'press'
  d: V3
  sledRot: Quat
  feet: { side: 'l' | 'r'; rot: Quat; local: V3 }[]
  s: [number, number]
  /** body offset from the hip point (seated on the drawn seat pan) */
  shift: V3
  /** single-leg press: the resting leg, bent and held out to the side clear of the plate */
  free?: 'l' | 'r'
}

/** tier C variants (squat/variants.ts) sample themselves */
type Extra = { kind: 'extra'; sample: (u: number) => Pose }

type Ctx = { tempo: Tempo; setup: Setup; v: Stand | Press | Extra }

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

function unsupported(p: P) {
  if (p.implement === 'machine') return p.machine === 'leg_press' ? null : `machine ${p.machine}`
  if (p.posture !== 'standing') return `${p.implement}/${p.posture}`
  if ((p.implement === 'barbell' || p.implement === 'smith') && !['back_high', 'back_low', 'front_rack'].includes(p.hold)) return `${p.implement} hold ${p.hold}`
  if (p.implement === 'smith' && p.hold === 'front_rack') return 'smith front rack'
  if (p.implement === 'dumbbell' && p.hold !== 'goblet' && p.hold !== 'two_hand') return `dumbbell hold ${p.hold}`
  if (p.implement === 'kettlebell' && p.hold !== 'goblet' && p.hold !== 'front_rack') return `kettlebell hold ${p.hold}`
  if (p.box && !(p.implement === 'barbell' && p.hold === 'back_high')) return `${p.implement} ${p.hold} box squat`
  if (p.heelsElevated && p.hold !== 'goblet') return `heels elevated ${p.hold}`
  return null
}

function gripContacts(id: string): Contact[] {
  return [
    { site: 'grip_l', kind: 'grip', target: { implement: id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: id, grip: 'r' } },
  ]
}

function rackContacts(id: string): Contact[] {
  return [
    { site: 'fingers_l', kind: 'grip', target: { implement: id, grip: 'l' } },
    { site: 'fingers_r', kind: 'grip', target: { implement: id, grip: 'r' } },
  ]
}

function standContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const smith = p.implement === 'smith'
  const railZ = smith ? 0 : undefined
  const heels = p.heelsElevated ? heelStance(skel, stanceWidth(skel, p.stance as StanceName), p.toeOut) : undefined
  const stance = heels?.stance ?? makeStance(skel, stanceWidth(skel, p.stance as StanceName), p.toeOut, smith ? SMITH_FEET[p.footPosition] : 0)
  const contacts: Contact[] = plantedContacts(skel, stance)
  const impls: ImplementSpec[] = []
  const v: Stand = { kind: 'stand', stance, holdKey: 'none', topDf: TOP_ANKLE }
  if (heels) {
    impls.push(heels.plate)
    v.heels = { pitch: heels.pitch, pose: heels.pose }
  }
  if (p.implement === 'barbell' || smith) {
    const rack = p.hold === 'front_rack'
    const bar = barbell({ gripWidth: (rack ? Math.min(p.gripWidth, RACK_GRIP) : p.gripWidth) * skel.data.shoulderWidth, plateKg: smith ? 20 : 40 })
    impls.push(bar)
    v.bar = bar
    const site = p.hold as NonNullable<Stand['barSite']>
    v.barSite = site
    v.barLocal = skel.data.sites[site].local
    v.holdKey = smith ? 'smith' : p.box ? 'box' : p.hold
    // front rack: the bar rides on the delts and lies across the fingers (a clean grip), wrists extended
    contacts.push(...(rack ? rackContacts(bar.id) : gripContacts(bar.id)))
    if (smith) {
      v.railZ = railZ
      impls.push({
        id: 'smith',
        kind: 'bench',
        mass: 0,
        com: [0, 0, 0],
        parts: [cyl([0.6, 0, railZ!], [0.6, 2.25, railZ!], 0.025), cyl([-0.6, 0, railZ!], [-0.6, 2.25, railZ!], 0.025), cyl([-0.6, 2.25, railZ!], [0.6, 2.25, railZ!], 0.03)],
        sites: {},
      })
    }
  } else if (p.implement === 'kettlebell' && p.hold === 'goblet') {
    const kb = kbGoblet()
    impls.push(kb)
    contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: kb.id, grip: 'horn_l' } }, { site: 'grip_r', kind: 'grip', target: { implement: kb.id, grip: 'horn_r' } })
    v.holdKey = 'goblet'
    v.held = { kind: 'kb_goblet', specs: [kb] }
  } else if (p.implement === 'kettlebell') {
    const kbs = kbRackPair()
    impls.push(...kbs)
    v.holdKey = 'kb_rack'
    const q = zeroQ(skel)
    trunk(skel, q, 0)
    stand(skel, q, stance, { knee: TOP_KNEE, df: TOP_ANKLE, tilt: 3 })
    const arms = kbRackArmPairs(skel, q)
    for (const [i, x] of arms) q[i] = x
    const inHand = kbRackInHand(skel, q, kbs[0])
    v.held = { kind: 'kb_rack', specs: kbs, arms, inHand }
    const other = inHand.site === 'corner_l' ? 'corner_r' : 'corner_l'
    contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: 'kb_l', grip: inHand.site } }, { site: 'grip_r', kind: 'grip', target: { implement: 'kb_r', grip: other } })
  } else if (p.implement === 'dumbbell' && p.hold === 'two_hand') {
    const db = dumbbell({ id: 'db', mass: HANG.kg })
    const [x, y, z] = HANG.hook
    const [, ay, az] = norm(HANG.axis)
    db.sites.hook_l = { pos: [x, y, z], axis: [0, ay, az] }
    db.sites.hook_r = { pos: [x, y, -z], axis: [0, ay, -az] }
    impls.push(db)
    contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: 'db', grip: 'hook_l' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'db', grip: 'hook_r' } })
    v.holdKey = 'hang'
    v.held = { kind: 'hang', specs: [db] }
    if (p.stance === 'wide') v.topKnee = WIDE_TOP_KNEE
  } else if (p.implement === 'dumbbell') {
    const db = dumbbell({ id: 'db', mass: DB_KG })
    const [x, y, z] = GOBLET.cup
    const [ax, ay, az] = gobletHand().axis
    db.sites.cup_l = { pos: [x, y, z], axis: [ax, ay, az] }
    db.sites.cup_r = { pos: [x, y, -z], axis: [ax, ay, -az] }
    impls.push(db)
    contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: 'db', grip: 'cup_l' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'db', grip: 'cup_r' } })
    v.holdKey = p.heelsElevated ? 'heels' : 'goblet'
    v.goblet = true
  }
  if (v.bar) {
    v.arms = solveBarArms(skel, v)
    // lockout: trunk upright, the whole body leans at the ankles until the bar sits over its line
    const q = zeroQ(skel)
    for (const [i, x] of v.arms) q[i] = x
    const target = railZ ?? stance.midfoot[2]
    v.topDf = root1d((df) => {
      setPelvis(skel, q, hipsFor(skel, stance, TOP_KNEE, df), 3)
      return barPos(skel, q, v)[2] - target
    }, -25, 25, { tol: 1e-7 }).x
  }
  const setup: Setup = {
    implements: impls,
    contacts,
    tempo,
    symmetric: true,
    // the Smith rails carry any horizontal load, so the feet do not have to sit under the bar. Without load the
    // centre of mass may sit towards the heel, which keeps the trunk more upright
    balance: smith ? undefined : v.bar ? { point: { implement: v.bar.id }, over: 'midfoot', tol: 0.025 } : { point: 'com', over: 'midfoot', tol: 0.025, target: v.goblet || v.held ? 0 : UNLOADED_COM },
  }
  if (v.bar) setup.rests = [{ implement: v.bar.id, regions: BAR_REST[v.barSite!], tol: 20 }]
  // the dumbbell rests on the chest and the cupped palms press on the top head
  if (v.goblet) setup.rests = [{ implement: 'db', regions: ['trunk', 'hand_l', 'hand_r'], tol: 15 }]
  if (v.barSite === 'front_rack') setup.limits = { 'wrist_l.flex': RACK_WRIST, 'wrist_r.flex': RACK_WRIST }
  if (v.held?.kind === 'hang') setup.tolerances = { body: { 'trunk / upperarm_l': HANG.chest, 'trunk / upperarm_r': HANG.chest } }
  if (v.held?.kind === 'kb_goblet') setup.rests = [{ implement: 'kb', regions: ['trunk', 'hand_l', 'hand_r'], tol: 15 }]
  if (v.held?.kind === 'kb_rack') setup.rests = (['l', 'r'] as const).map((s) => ({ implement: `kb_${s}`, regions: [`forearm_${s}`, `hand_${s}`, `upperarm_${s}`, 'trunk'], tol: 12 }))
  if (v.heels) {
    setup.rests = [...(setup.rests ?? []), { implement: 'plate', regions: ['foot_l', 'foot_r'], tol: 15 }]
    // the forefoot capsule is rigid with the pitched foot and dips ~13 mm under the floor where the real toes lie flat
    // (lead decision, as the calf raise's FOREFOOT_REST)
    setup.tolerances = { floor: HEEL_PLATE.floorTol }
  }
  const ctx: Ctx = { tempo, setup, v }
  if (v.goblet || v.held?.kind === 'kb_goblet') v.bottomKnee = gobletBottom(p, skel, ctx, v)
  if (v.held?.kind === 'kb_rack') v.bottomKnee = rackBottom(p, skel, ctx, v)
  if (p.box) {
    const box = boxFor(p, skel, ctx, v)
    impls.push(box.spec)
    v.box = box.pose
    setup.rests = [...(setup.rests ?? []), { implement: 'box', regions: ['trunk', 'thigh_l', 'thigh_r'], tol: 15 }]
  }
  return ctx
}

/** front rack bells: the squat bottoms out where the bells or the elbows come down to the thighs, never deeper than the
 * depth table */
function rackBottom(p: P, skel: Skeleton, ctx: Ctx, v: Stand) {
  const [ecc, pb, , pt] = ctx.tempo
  const u = (pt / 2 + ecc + pb / 2) / loopDuration(ctx.tempo)
  const gap = (knee: number) => {
    v.bottomKnee = knee
    const pose = sampleStand(u, p, skel, ctx, v)
    const caps = bodyCapsules(skel, fk(skel, pose.q))
    const thighs = caps.filter((c) => c.region.startsWith('thigh_'))
    const arms = caps.filter((c) => /^(upperarm|forearm)_/.test(c.region))
    const bells = pose.implements.filter((x) => x.id.startsWith('kb_')).flatMap((x) => placeParts({ ...v.held!.specs[0], parts: v.held!.specs[0].parts.slice(0, 6) }, x))
    const bell = Math.min(...bells.flatMap((b) => thighs.map((t) => capsuleSolidClearance(t, b)))) - KB_RACK_THIGH.bell
    // the tucked elbows come down onto the thighs: a light touch, inside the arm-thigh soft-tissue tolerance
    const arm = Math.min(...arms.flatMap((a) => thighs.map((t) => capsuleClearance(a, t)))) - KB_RACK_THIGH.arm
    return Math.min(bell, arm)
  }
  const max = KNEE[p.depth]
  if (gap(max) >= 0) return max
  return root1d(gap, Math.min(max, KNEE.quarter), max, { tol: 1e-3, scan: 4 }).x
}

/** both feet with the balls on the floor and the heels on a plate lying flat behind them */
function heelStance(skel: Skeleton, width: number, toeOut: number) {
  const { r, w } = PLATE[HEEL_PLATE.kg]
  const flat = makeStance(skel, width, toeOut)
  const feet = flat.feet.map((f0) => {
    const ball = add(f0.ankle, qrot(f0.rot, skel.data.sites[`ball_${f0.side}`].local))
    const at = (pitch: number): FootTarget => {
      const rot = qmul(f0.rot, qaxis([1, 0, 0], pitch * DEG))
      return { side: f0.side, rot, ankle: sub(ball, qrot(rot, skel.data.sites[`ball_${f0.side}`].local)) }
    }
    const heelY = (f: FootTarget) => add(f.ankle, qrot(f.rot, skel.data.sites[`heel_${f.side}`].local))[1]
    const pitch = root1d((x) => heelY(at(x)) - w, 0, 40, { tol: 1e-9 }).x
    return { foot: at(pitch), pitch }
  })
  const heel = (f: FootTarget) => add(f.ankle, qrot(f.rot, skel.data.sites[`heel_${f.side}`].local))
  const h = heel(feet[0].foot)
  const z = h[2] + HEEL_PLATE.inset - Math.sqrt(r * r - h[0] * h[0])
  const plate = weightPlate({ id: 'plate', kg: HEEL_PLATE.kg })
  const pose: ImplementPose = { id: 'plate', pos: [0, w / 2, z], rot: qaxis([1, 0, 0], Math.PI / 2) }
  const mids = feet.map(({ foot }) => add(foot.ankle, qrot(foot.rot, skel.data.sites[`midfoot_${foot.side}`].local)))
  const stance: StanceSetup = { feet: feet.map((f) => f.foot), midfoot: [0, 0, (mids[0][2] + mids[1][2]) / 2], pitch: feet[0].pitch }
  return { stance, pitch: feet[0].pitch, plate, pose }
}

/** box squat: a plyo box whose tread meets the glutes at the bottom of the rep */
function boxFor(p: P, skel: Skeleton, ctx: Ctx, v: Stand) {
  const [ecc, pb, , pt] = ctx.tempo
  const u = (pt / 2 + ecc + pb / 2) / loopDuration(ctx.tempo)
  const f = fk(skel, sampleStand(u, p, skel, ctx, v).q)
  const hip = localToWorld(skel, f, 'pelvis', hipMidLocal(skel))
  const caps = bodyCapsules(skel, f).filter((c) => c.region === 'trunk' || c.region.startsWith('thigh_'))
  const depth = 0.45, width = 0.6
  const centre: V3 = [0, 0, hip[2] + BOX.ahead - depth / 2]
  const probe = restAgainst(caps, { shape: 'box', center: [centre[0], hip[1] - 0.3, centre[2]], size: [width, 0.02, depth] }, [0, -1, 0], -BOX.sink)
  const height = probe.center[1] + 0.01
  const spec = plyoBox({ id: 'box', height })
  return { spec, pose: { id: 'box', pos: centre, rot: qid() } as ImplementPose }
}

/** knee flexion at which the arms meet the thighs at the bottom of a goblet squat, capped by the depth table */
function gobletBottom(p: P, skel: Skeleton, ctx: Ctx, v: Stand) {
  const [ecc, pb, , pt] = ctx.tempo
  const u = (pt / 2 + ecc + pb / 2) / loopDuration(ctx.tempo)
  const gap = (knee: number) => {
    v.bottomKnee = knee
    const caps = bodyCapsules(skel, fk(skel, sampleStand(u, p, skel, ctx, v).q))
    const arms = caps.filter((c) => /^(upperarm|forearm)_/.test(c.region))
    const thighs = caps.filter((c) => c.region.startsWith('thigh_'))
    return Math.min(...arms.flatMap((a) => thighs.map((t) => capsuleClearance(a, t)))) - GOBLET_ARMS_ON_THIGHS
  }
  const max = KNEE[p.depth]
  if (gap(max) >= 0) return max
  return root1d(gap, Math.min(max, KNEE.parallel), max, { tol: 1e-3, scan: 3 }).x
}

function trunk(skel: Skeleton, q: Float64Array, s: number) {
  setDofs(skel, q, { 'lumbar.flex': 8 * s, 'thorax.flex': 4 * s })
}

function gaze(skel: Skeleton, q: Float64Array) {
  const d = skel.dof
  const pitch = q[d['pelvis.tilt']] + q[d['lumbar.flex']] + q[d['thorax.flex']]
  setDofs(skel, q, { 'neck.flex': -0.4 * pitch, 'head.flex': -0.2 * pitch })
}

const ARM_DOFS = ['clavicle_*.prot', 'clavicle_*.elev', 'scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev', 'grip_*.close']

function barPos(skel: Skeleton, q: Float64Array, v: Stand): V3 {
  return localToWorld(skel, fk(skel, q), 'thorax2', v.barLocal!)
}

/**
 * Arms on a bar that rides on the torso, solved once in a standing pose (elbow and palm directions in the thorax
 * frame). The left arm is solved and mirrored, so the hold is exactly symmetric.
 */
function solveBarArms(skel: Skeleton, v: Stand): [number, number][] {
  const q = zeroQ(skel)
  trunk(skel, q, 0)
  setDofs(skel, q, { 'clavicle_*.prot': -12, 'clavicle_*.elev': 4, 'grip_*.close': 1 })
  stand(skel, q, v.stance, { knee: TOP_KNEE, df: TOP_ANKLE, tilt: 3 })
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  const T = (x: number, y: number, z: number) => qrot(thorax, [x, y, z])
  if (v.barSite === 'front_rack') solveRack(skel, q, v)
  else {
    const g = siteWorld(v.bar!, { id: v.bar!.id, pos: barPos(skel, q, v), rot: qid() }, 'l')
    // high bar: elbows down and back; low bar: elbows back and up
    const pole = v.barSite === 'back_low' ? T(0.5, -0.3, -1) : T(0.4, -0.7, -0.6)
    attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: T(0, 0.3, 1) }, { pole, wristBias: v.barSite === 'back_low' ? 20 : 10, planeHint: -90 })
  }
  return ARM_DOFS.flatMap((k) => {
    const x = q[skel.dof[k.replace('*', 'l')]]
    return [[skel.dof[k.replace('*', 'l')], x], [skel.dof[k.replace('*', 'r')], x]] as [number, number][]
  })
}

/** front rack arm (left; mirrored by the caller) and the bar position in the thorax frame it puts the bar at */
function solveRack(skel: Skeleton, q: Float64Array, v: Stand) {
  setDofs(skel, q, { 'clavicle_l.prot': RACK.clavicle.prot, 'clavicle_l.elev': RACK.clavicle.elev, 'grip_l.close': 0.6 })
  const names = ['shoulder_l.plane', 'shoulder_l.elev', 'shoulder_l.rot', 'elbow_l.flex', 'forearm_l.pro', 'wrist_l.flex', 'wrist_l.dev'].map((n) => skel.dof[n])
  const lo = [30, 45, -100, 115, -90, RACK_WRIST[0], -35], hi = [125, 105, 70, 150, 85, RACK_WRIST[1], 20]
  const site = skel.data.sites.fingers_l
  const g = v.bar!.sites.l.pos[0]
  const r = (v.bar!.parts[0] as Extract<Part, { shape: 'cylinder' }>).r
  const measure = (x: number[]) => {
    names.forEach((d, i) => (q[d] = x[i]))
    setScapula(skel, q, 'l')
    const f = fk(skel, q)
    const t = skel.seg.thorax2
    const tip = qrot(qconj(f.rot[t]), sub(localToWorld(skel, f, 'hand_l', site.local), f.pos[t]))
    const bar = { a: localToWorld(skel, f, 'thorax2', [-0.35, tip[1], tip[2]]), b: localToWorld(skel, f, 'thorax2', [0.35, tip[1], tip[2]]), r }
    const caps = bodyCapsules(skel, f)
    const clear = (regions: string[]) => Math.min(...caps.filter((c) => regions.includes(c.region)).map((c) => capsuleClearance(c, bar)))
    const arm = caps.filter((c) => c.region === 'upperarm_l'), chest = caps.filter((c) => c.region === 'trunk')
    const press = Math.max(0, ...arm.flatMap((a) => chest.map((c) => -capsuleClearance(a, c) - 0.006)))
    const head = caps.filter((c) => c.region === 'neck' || c.region === 'head')
    const hand = caps.filter((c) => c.region === 'hand_l' || c.region === 'forearm_l')
    const handHead = Math.min(...hand.flatMap((a) => head.map((c) => capsuleClearance(a, c))))
    const across = qrot(f.rot[skel.seg.hand_l], site.axis!)
    const slant = Math.acos(Math.min(1, Math.abs(dot(across, qrot(f.rot[t], [1, 0, 0]))))) / DEG
    const palmUp = dot(qrot(f.rot[skel.seg.hand_l], site.normal!), qrot(f.rot[t], [0, 1, 0]))
    return { tip, shelf: clear(['upperarm_l', 'girdle_l']), throat: clear(['neck', 'head']), chest: clear(['trunk']), press, handHead, slant, palmUp }
  }
  const res = (x: number[]) => {
    const m = measure(x)
    return [
      (m.tip[0] - g) * 300,
      (m.shelf + RACK.sink) * 100,
      Math.max(0, RACK.throat - m.throat) * 200,
      Math.max(0, -m.chest - 0.012) * 100,
      (x[1] - RACK.elev) * 0.1,
      (x[5] + 80) * 0.01,
      Math.max(0, m.slant - 35) * 0.05,
      Math.max(0, 0.4 - m.palmUp) * 5,
      m.press * 100,
      Math.max(0, 0.005 - m.handHead) * 100,
    ]
  }
  let best: { x: number[]; err: number } | null = null
  for (const seed of RACK_SEEDS) {
    const r0 = dls(res, seed, { iters: 120, lo, hi })
    if (!best || r0.err < best.err) best = r0
  }
  const m = measure(best!.x)
  v.barLocal = [0, m.tip[1], m.tip[2]]
}

function bodyweightArms(skel: Skeleton, q: Float64Array, p: P, s: number) {
  if (p.armPosition === 'forward') setDofs(skel, q, { 'shoulder_*.plane': 90, 'shoulder_*.elev': 60 + 30 * s, 'elbow_*.flex': 5, 'forearm_*.pro': 40, 'grip_*.close': 0.2 })
  else if (p.armPosition === 'crossed') setDofs(skel, q, { 'shoulder_*.plane': 110, 'shoulder_*.elev': 80, 'elbow_*.flex': 140, 'shoulder_*.rot': 60 })
  else setDofs(skel, q, { 'shoulder_*.plane': 0, 'shoulder_*.elev': 25, 'shoulder_*.rot': 60, 'elbow_*.flex': 100 })
  scapulae(skel, q)
}

/** sumo: the dumbbell hangs upright, the midpoint of its hooks `reach` from the shoulder joints' midpoint, as little in front of
 * them as keeps the arms off the thighs */
function hangPose(skel: Skeleton, f: ReturnType<typeof fk>, spec: ImplementSpec): ImplementPose {
  const sh = scale(add(f.pos[skel.seg.humerus_l], f.pos[skel.seg.humerus_r]), 0.5)
  const fwd = qrot(f.rot[skel.seg.thorax2], [0, 0, 1])
  const dir = norm([fwd[0], 0, fwd[2]])
  const mid: V3 = [spec.sites.hook_l.pos[0], spec.sites.hook_l.pos[1], 0]
  const at = (d: number): ImplementPose => ({ id: spec.id, pos: sub(add(add(sh, [0, -Math.sqrt(HANG.reach ** 2 - d * d), 0]), scale(dir, d)), qrot(GOBLET_ROT, mid)), rot: GOBLET_ROT })
  const thighs = bodyCapsules(skel, f).filter((c) => c.region.startsWith('thigh_'))
  const gap = (d: number) => {
    const pose = at(d)
    // each arm as the line from its hook up to its shoulder joint
    const arms = (['l', 'r'] as const).map((k) => ({ a: siteWorld(spec, pose, `hook_${k}`).pos, b: f.pos[skel.seg[`humerus_${k}`]], r: HANG.hand }))
    return Math.min(...arms.flatMap((arm) => thighs.map((c) => capsuleClearance(c, arm))))
  }
  if (gap(HANG.ahead) >= 0) return at(HANG.ahead)
  let lo = HANG.ahead, hi = 0.4
  for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2
    if (gap(m) >= 0) hi = m
    else lo = m
  }
  return at(hi)
}

/** both hands hook the hanging dumbbell's top head from the sides, palms in (left solved, right mirrored) */
function hangArms(skel: Skeleton, q: Float64Array, spec: ImplementSpec) {
  setDofs(skel, q, { 'clavicle_*.prot': HANG.prot, 'clavicle_*.elev': -2, 'grip_*.close': 1 })
  const pose = hangPose(skel, fk(skel, q), spec)
  const g = siteWorld(spec, pose, 'hook_l')
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: qrot(pose.rot, HANG.palm) }, { pole: [0.3, 0, -1], planeHint: 100, wristBias: 0 })
  for (const k of ARM_DOFS) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

/** the poses of the loads held in front without a bar */
function heldPoses(skel: Skeleton, f: ReturnType<typeof fk>, held: NonNullable<Stand['held']>): ImplementPose[] {
  if (held.kind === 'kb_goblet') return [kbGobletPose(skel, f, held.specs[0])]
  if (held.kind === 'kb_rack') return kbRackPoses(skel, f, held.inHand!)
  return [hangPose(skel, f, held.specs[0])]
}

function heldArms(skel: Skeleton, q: Float64Array, held: NonNullable<Stand['held']>) {
  if (held.kind === 'kb_goblet') kbGobletArms(skel, q, held.specs[0])
  else if (held.kind === 'kb_rack') for (const [i, x] of held.arms!) q[i] = x
  else hangArms(skel, q, held.specs[0])
}

/** a dumbbell (id 'db') with the goblet cup sites under its top head, for other templates' goblet holds */
export function gobletDumbbell(mass: number): ImplementSpec {
  const db = dumbbell({ id: 'db', mass })
  const [x, y, z] = GOBLET.cup
  const [ax, ay, az] = gobletHand().axis
  db.sites.cup_l = { pos: [x, y, z], axis: [ax, ay, az] }
  db.sites.cup_r = { pos: [x, y, -z], axis: [ax, ay, -az] }
  return db
}

/** left cupped hand in the dumbbell frame: palm up and in, fingers up and forward; pinky-to-index line and palm */
function gobletHand(): { axis: V3; palm: V3 } {
  const f = norm(GOBLET.fingers)
  const p0 = norm(GOBLET.palm)
  const palm = norm(sub(p0, scale(f, dot(p0, f))))
  return { axis: cross(palm, f), palm }
}

let gobletLast: { skel: Skeleton; key: string; pose: ImplementPose } | null = null

/** goblet dumbbell: vertical, resting against the chest in front of the sternum */
export function gobletPose(skel: Skeleton, f: ReturnType<typeof fk>, spec: ImplementSpec): ImplementPose {
  const t = skel.seg.thorax2
  const key = `${f.pos[t].join()}|${f.rot[t].join()}`
  if (gobletLast?.skel === skel && gobletLast.key === key) return gobletLast.pose
  const base = add(localToWorld(skel, f, 'thorax2', skel.data.sites.sternum.local), [0, GOBLET.up, 0])
  const fwd = qrot(f.rot[t], [0, 0, 1])
  const dir = norm([fwd[0], 0, fwd[2]])
  const chest = bodyCapsules(skel, f).filter((c) => c.region === 'trunk' && c.segment.startsWith('thorax'))
  const at = (d: number): ImplementPose => ({ id: 'db', pos: add(base, scale(dir, d)), rot: GOBLET_ROT })
  // the heads meet the chest before the handle does; clearance grows almost linearly with the distance, so secant steps
  const heads = { ...spec, parts: spec.parts.slice(1) }
  const gap = (d: number) => Math.min(...placeParts(heads, at(d)).flatMap((sd) => chest.map((c) => capsuleSolidClearance(c, sd)))) + GOBLET.sink
  let d0 = 0.1, d1 = 0.2, g0 = gap(d0), g1 = gap(d1)
  for (let k = 0; k < 12 && Math.abs(g1) > 1e-6 && g1 !== g0; k++) {
    const d2 = Math.min(0.4, Math.max(0, d1 - (g1 * (d1 - d0)) / (g1 - g0)))
    ;[d0, g0, d1, g1] = [d1, g1, d2, gap(d2)]
  }
  const pose = at(d1)
  gobletLast = { skel, key, pose }
  return pose
}

/** both palms onto the top head (left solved, right mirrored) */
export function gobletArms(skel: Skeleton, q: Float64Array, spec: ImplementSpec) {
  setDofs(skel, q, { 'clavicle_*.prot': 6, 'clavicle_*.elev': 2, 'grip_*.close': 1 })
  const pose = gobletPose(skel, fk(skel, q), spec)
  const g = siteWorld(spec, pose, 'cup_l')
  const palm = qrot(pose.rot, gobletHand().palm)
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm }, { pole: [-0.1, -1, 0.5], planeHint: 60, wristBias: 40 })
  for (const k of ARM_DOFS) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

function scapulae(skel: Skeleton, q: Float64Array) {
  setScapula(skel, q, 'l')
  setScapula(skel, q, 'r')
}

function sampleStand(u: number, p: P, skel: Skeleton, ctx: Ctx, v: Stand): Pose {
  const s = 1 - phaseAt(u, ctx.tempo).c
  // knees and ankles trail the hips slightly
  const sk = 1 - phaseAt(u, ctx.tempo, 0.012).c
  const knee = lerp(v.topKnee ?? TOP_KNEE, v.bottomKnee ?? KNEE[p.depth], sk)
  const df = lerp(v.topDf, ANKLE[v.holdKey][p.depth], sk)
  const q = zeroQ(skel)
  trunk(skel, q, s)
  setDofs(skel, q, { 'clavicle_*.prot': -12, 'clavicle_*.elev': 4, 'grip_*.close': 1 })
  if (v.bar) {
    for (const [i, x] of v.arms!) q[i] = x
    // bar over the midfoot (or on the Smith rail): 1-D root find on pelvis tilt
    // with the hips set by knee and ankle
    const hipMid = hipsFor(skel, v.stance, knee, df)
    const target = v.railZ ?? v.stance.midfoot[2]
    const measure = (qq: Float64Array) => barPos(skel, qq, v)[2]
    const r = root1d((tilt) => {
      setPelvis(skel, q, hipMid, tilt)
      return measure(q) - target
    }, -15, 80, { tol: 1e-7 })
    stand(skel, q, v.stance, { knee, df, tilt: r.x })
  } else {
    // no bar: trunk lean keyed, ankles bring the system COM over the midfoot
    const db = ctx.setup.implements.find((i) => i.id === 'db')!
    const held = v.held
    const upper = held ? (qq: Float64Array) => heldArms(skel, qq, held) : v.goblet ? (qq: Float64Array) => gobletArms(skel, qq, db) : (qq: Float64Array) => bodyweightArms(skel, qq, p, s)
    const measure = (qq: Float64Array) => {
      const f = fk(skel, qq)
      const loads = held ? heldPoses(skel, f, held).map((x, k) => ({ mass: held.specs[k].mass, pos: x.pos })) : v.goblet ? [{ mass: DB_KG, pos: gobletPose(skel, f, db).pos }] : []
      return centerOfMass(skel, f, loads)[2]
    }
    const target = v.goblet || held ? 0 : UNLOADED_COM
    standBalanced(skel, q, v.stance, { knee, tilt: 3 + TILT[v.holdKey] * s }, (qq) => measure(qq) - target, upper, [-10 - (v.heels?.pitch ?? 0), 40])
  }
  if (v.heels) setDofs(skel, q, { 'toe_*.flex': -v.heels.pitch })
  gaze(skel, q)
  const implements_: ImplementPose[] = []
  if (v.bar) {
    const bp: ImplementPose = { id: v.bar.id, pos: barPos(skel, q, v), rot: qid() }
    implements_.push(bp)
    if (v.railZ !== undefined) implements_.push({ id: 'smith', pos: [0, 0, 0], rot: qid() })
  } else if (v.held) {
    implements_.push(...heldPoses(skel, fk(skel, q), v.held))
  } else if (v.goblet) {
    implements_.push(gobletPose(skel, fk(skel, q), ctx.setup.implements.find((i) => i.id === 'db')!))
  }
  if (v.heels) implements_.push(v.heels.pose)
  if (v.box) implements_.push(v.box)
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

// ---------- leg press ----------

function pressPelvis(skel: Skeleton, q: Float64Array, shift: V3) {
  // arms rest on the side handles; the handles are placed where these angles put the hands
  setDofs(skel, q, {
    'lumbar.flex': 4, 'thorax.flex': 6, 'neck.flex': 22, 'head.flex': 10, 'clavicle_*.prot': -5, 'grip_*.close': 1,
    'shoulder_*.plane': 35, 'shoulder_*.elev': 22, 'elbow_*.flex': 55, 'forearm_*.pro': 10,
  })
  setPelvis(skel, q, add(PRESS_HIP, shift), -(PRESS_RECLINE + 10))
}

const SEAT_ROT = qmul(qaxis([1, 0, 0], -PRESS_SEAT.tilt * DEG), qfromBasis([1, 0, 0], [0, 1, 0]))
const SEAT_PAD = 0.06

/** seat pan under the pelvis, resting against the measured body (the glutes sink ~1 cm into the padding) */
function pressSeat(skel: Skeleton, f: ReturnType<typeof fk>) {
  const guess = add(localToWorld(skel, f, 'pelvis', [0, -0.12, 0.12]), [0, -0.03, 0])
  const trunkCaps = bodyCapsules(skel, f).filter((c) => c.region === 'trunk')
  return restAgainst(trunkCaps, { shape: 'box', center: guess, size: [0.42, SEAT_PAD, 0.42], rot: SEAT_ROT, pad: true }, neg(qrot(SEAT_ROT, [0, 1, 0])))
}

/** body offset from the hip point that seats the lifter on the drawn machine's seat pan */
function pressShift(skel: Skeleton): V3 {
  const q = zeroQ(skel)
  pressPelvis(skel, q, [0, 0, 0])
  const seat = pressSeat(skel, fk(skel, q))
  const n = qrot(SEAT_ROT, [0, 1, 0])
  const t = PRESS_SEAT.tilt * DEG
  const drawn = add(PRESS_HIP, add(scale([0, Math.sin(t), Math.cos(t)], PRESS_SEAT.along), scale(n, -PRESS_SEAT.drop)))
  return scale(n, dot(sub(drawn, add(seat.center, scale(n, SEAT_PAD / 2))), n))
}

function freeLeg(skel: Skeleton, q: Float64Array, side: 'l' | 'r') {
  setDofs(skel, q, { [`hip_${side}.flex`]: PRESS_FREE.flex, [`hip_${side}.abd`]: PRESS_FREE.abd, [`knee_${side}.flex`]: PRESS_FREE.knee, [`ankle_${side}.df`]: PRESS_FREE.df })
}

function pressFeet(skel: Skeleton, v: Pick<Press, 'd' | 'sledRot' | 'feet'>, s: number): FootTarget[] {
  const origin = add(PRESS_HIP, scale(v.d, s))
  return v.feet.map((f) => {
    const spot = add(origin, qrot(v.sledRot, f.local))
    return { side: f.side, rot: f.rot, ankle: sub(spot, qrot(f.rot, skel.data.sites[`midfoot_${f.side}`].local)) }
  })
}

function pressLegs(skel: Skeleton, q: Float64Array, feet: FootTarget[]) {
  const f = fk(skel, q)
  const pr = f.rot[skel.seg.pelvis]
  return feet.map((foot) => {
    const leg = legKinematics(skel, foot.side, f.pos[skel.seg[`femur_${foot.side}`]], pr, foot)
    writeLeg(skel, q, foot.side, leg)
    return leg
  })
}

function pressContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const a = p.sledAngle * DEG
  const d: V3 = [0, Math.sin(a), Math.cos(a)]
  const up: V3 = [0, Math.cos(a), -Math.sin(a)]
  // sled frame: X across, Y = plate normal towards the lifter, Z up the plate
  const sledRot = qfromBasis([1, 0, 0], neg(d))
  const half = stanceWidth(skel, p.stance as StanceName) / 2
  const shift = pressShift(skel)
  const work: 'l' | 'r' = p.side === 'left' ? 'l' : 'r'
  const one = p.laterality === 'unilateral'
  const q = zeroQ(skel)
  pressPelvis(skel, q, shift)
  if (one) freeLeg(skel, q, work === 'l' ? 'r' : 'l')
  const placed = (e: number) => ({
    d,
    sledRot,
    feet: (one ? [work] : (['l', 'r'] as const)).map((side: 'l' | 'r') => ({
      side,
      rot: qmul(qaxis(neg(d), (side === 'l' ? p.toeOut : -p.toeOut) * DEG), sledRot),
      local: [(side === 'l' ? 1 : -1) * (one ? PRESS_ONE_X : half), 0, e] as V3,
    })),
  })
  const legAt = (e: number, s: number) => pressLegs(skel, q, pressFeet(skel, placed(e), s))[0]
  const sFor = (e: number, knee: number) => root1d((s) => legAt(e, s).knee - knee, 0.2, 1.1, { tol: 1e-7 }).x
  // foot height on the plate: dorsiflexion at the bottom hits the footPosition target
  const eFor = (knee: number) => root1d((e) => legAt(e, sFor(e, knee)).ankle[0] - PRESS_DF[p.footPosition], -0.3, 0.4, { tol: 1e-6 }).x
  let bottom = PRESS_KNEE[p.depth]
  let e = eFor(bottom)
  for (let k = 0; k < 20 && legAt(e, sFor(e, bottom)).hip[0] > PRESS_HIP_MAX; k++) e = eFor((bottom -= 2))
  const s: [number, number] = [sFor(e, bottom), sFor(e, PRESS_TOP_KNEE)]
  const v0 = placed(e)
  const f0 = fk(skel, q)
  const hand = (side: 'l' | 'r') => handFrame(skel, f0, side)
  const handle = (side: 'l' | 'r') => {
    const h = hand(side)
    return cyl(add(h.pos, scale(h.axis, -0.1)), add(h.pos, scale(h.axis, 0.1)), 0.016)
  }
  const handles: ImplementSpec = {
    id: 'handles',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [handle('l'), handle('r')],
    sites: { l: { pos: hand('l').pos, axis: hand('l').axis }, r: { pos: hand('r').pos, axis: hand('r').axis } },
  }
  // seat pan under the pelvis and back pad behind the trunk (static, drawn only)
  const back = norm(sub(f0.pos[skel.seg.neck1], f0.pos[skel.seg.pelvis]))
  const behind = norm(cross(back, [1, 0, 0]))
  const padRot = qfromBasis([1, 0, 0], neg(behind))
  const padGuess = add(scale(add(f0.pos[skel.seg.pelvis], f0.pos[skel.seg.neck1]), 0.5), scale(behind, 0.14))
  // pads rest against the measured body: the back and glutes sink ~1 cm into the padding
  const trunkCaps = bodyCapsules(skel, f0).filter((c) => c.region === 'trunk')
  const padBox = restAgainst(trunkCaps, { shape: 'box', center: padGuess, size: [0.4, 0.06, 0.75], rot: padRot, pad: true }, behind)
  const seatBox = pressSeat(skel, f0)
  const seatMid = seatBox.center
  const railFrom = add(PRESS_HIP, add(scale(d, s[0] + 0.05), scale(up, -0.3)))
  const railTo = add(PRESS_HIP, add(scale(d, s[1] + 0.6), scale(up, -0.3)))
  const frame: ImplementSpec = {
    id: 'press',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      padBox,
      seatBox,
      cyl(add(railFrom, [0.3, 0, 0]), add(railTo, [0.3, 0, 0]), 0.03),
      cyl(add(railFrom, [-0.3, 0, 0]), add(railTo, [-0.3, 0, 0]), 0.03),
      cyl(add(seatMid, [0, -0.05, 0]), [0, 0, seatMid[2]], 0.04),
    ],
    sites: {},
  }
  const sledSites: Record<string, { pos: V3 }> = {}
  const feet = pressFeet(skel, v0, 0)
  for (const f of feet) for (const site of ['heel', 'ball']) {
    const name = `${site}_${f.side}`
    sledSites[name] = { pos: qrot(qconj(sledRot), sub(add(f.ankle, qrot(f.rot, skel.data.sites[name].local)), PRESS_HIP)) }
  }
  const sled: ImplementSpec = {
    id: 'sled',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [{ shape: 'box', center: [0, -0.02, 0.05], size: [0.75, 0.04, 0.7], pad: true }, cyl([0.3, -0.04, -0.3], [0.3, -0.12, -0.3], 0.03), cyl([-0.3, -0.04, -0.3], [-0.3, -0.12, -0.3], 0.03)],
    sites: sledSites,
  }
  // feet ride on the sled, so they are checked like grips (distance to the moving plate), not as floor contacts
  const contacts: Contact[] = [
    ...feet.flatMap((f) => ['heel', 'ball'].map((site) => ({ site: `${site}_${f.side}`, kind: 'grip' as const, target: { implement: 'sled', grip: `${site}_${f.side}` } }))),
    ...gripContacts('handles'),
  ]
  const setup: Setup = { implements: [sled, frame, handles], contacts, tempo, symmetric: !one }
  return { tempo, setup, v: { kind: 'press', d, sledRot, feet: v0.feet, s, shift, free: one ? (work === 'l' ? 'r' : 'l') : undefined } }
}

function samplePress(u: number, skel: Skeleton, ctx: Ctx, v: Press): Pose {
  const c = phaseAt(u, ctx.tempo).c
  const sled = lerp(v.s[0], v.s[1], c)
  const q = zeroQ(skel)
  pressPelvis(skel, q, v.shift)
  if (v.free) freeLeg(skel, q, v.free)
  pressLegs(skel, q, pressFeet(skel, v, sled))
  const hp: ImplementPose = { id: 'handles', pos: [0, 0, 0], rot: qid() }
  return {
    q,
    implements: [{ id: 'sled', pos: add(PRESS_HIP, scale(v.d, sled)), rot: v.sledRot }, { id: 'press', pos: [0, 0, 0], rot: qid() }, hp],
    contacts: ctx.setup.contacts,
  }
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  if (isVariant(p)) {
    const x = variant(p, skel)
    return { tempo: x.tempo, setup: x.setup, v: { kind: 'extra', sample: x.sample } }
  }
  const why = unsupported(p)
  if (why) throw new Error(`squat: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? (p.box ? BOX_TEMPO : DEFAULT_TEMPO)
  return p.implement === 'machine' ? pressContext(p, skel, tempo) : standContext(p, skel, tempo)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  if (ctx.v.kind === 'extra') return ctx.v.sample(u)
  return ctx.v.kind === 'press' ? samplePress(u, skel, ctx, ctx.v) : sampleStand(u, p, skel, ctx, ctx.v)
}

export const squat: Template<P> = {
  id: 'squat',
  driver: 'implement',
  params: SCHEMAS.squat,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}


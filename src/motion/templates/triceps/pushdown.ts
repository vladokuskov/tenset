import { attachHand, handFrame, root1d } from '../../constraints.ts'
import { centerOfPressure, fk, segPos, sitePos, type FK } from '../../fk.ts'
import { cableForce, cableHandle, siteWorld, type Cable, type ImplementSpec } from '../../implements.ts'
import { add, DEG, lerp, norm, qid, qrot, scale, sub, type V3 } from '../../math.ts'
import { zeroQ, setDofs, type ImplementPose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { limitSway, makeStance, plantedContacts, stanceWidth, standBalanced, type StanceSetup, type Sway } from '../standing.ts'
import type { Setup } from '../types.ts'
import { cyl, frameY, mirrorArm, setArm, type Base, type P, type Sampled } from './common.ts'
import { ROPE_IDS, ropeContacts, ropeHandle, ropeImplements, ropePoses, stackSpec } from './rope.ts'

// Cable pushdowns (rope 704, straight bar 715): upper arms at the sides, a little ahead of vertical against the
// trunk's lean, the elbow running from ~110-125 deg to lockout (research: pushdown shoulder 0, elbow ~120-140 -> 0).

/** elbow flexion at lockout and at the stretch, deg */
const PUSH_ELBOW = { rope: [4, 108], bar: [7, 125] } as const
/**
 * pushdown stance: slight knee bend, trunk leaning ~10 deg (pelvis tilt plus spine flexion). The upper arms stay at
 * the sides but a little ahead of vertical (`forward` deg of flexion against the lean), so lockout ends in front of
 * the thighs, not beside or behind them; `drift`: the elbows ease forward a little as the forearms rise
 */
const PUSH = { knee: 10, tilt: 6, lumbar: 2, thorax: 2, forward: 18, drift: 3 }
/** cable stack load for the balance, kg (the curls' value) */
export const CABLE_KG = 15
/** high pulley wheel centre, m (props/cable.ts PULLEY_HEIGHTS.high) */
export const HIGH = 2.0
/** pulley ahead of the midfoot for pushdowns, m: the cable leans a little towards the stack */
const PUSH_PULLEY_Z = 0.64
/**
 * rope pushdown: elbows tucked and turned in, so the fists meet in front at the stretch and the
 * ends spread to the thighs at lockout, where the palms turn back (pronation, radial deviation, a little extension)
 */
const ROPE_ARM = { abd: 0, rot: [20, 40], pro: 75, dev: 12, ext: 10 }
const BAR_PRO = 75
/** bar pushdown: elbows pointed out so they sit beside the ribs, not on them, deg */
const BAR_ABD = 16
/** the bar sits a little flatter across the palms (held towards the fingers), which keeps the wrists inside their deviation band, deg */
const BAR_OBLIQUE = 8
/** attachments stay this far off the front of the thighs at lockout, mm (the curls keep 10) */
const THIGH_CLEAR = 10
/**
 * balance band, m. The cable holds the hands up, so with the ankles still the centre of pressure swings back while
 * the forearms are level and forward at both ends of the rep (about +-35 mm rope, +-47 mm bar at 15 kg). A lifter
 * takes that inside the foot (heel 110 mm behind the midfoot, ball 57 mm ahead) instead of rocking, so the band is
 * centred on the swing and wider than ARM_BALANCE_TOL; the ankles follow only what is left over
 */
const PUSH_TOL = 0.05

export type Pushdown = Base & {
  kind: 'pushdown'
  stance: StanceSetup
  pulley: V3
  rope: boolean
  bar?: ImplementSpec
  elbow: readonly [number, number]
  sway?: Sway
  /** centre of the balance band, m ahead of the midfoot */
  target: number
}

function straightBar(p: P, skel: Skeleton): ImplementSpec {
  const base = cableHandle({ id: 'handle', attachment: 'straight_bar' })
  const g = (p.gripWidth * skel.data.shoulderWidth) / 2
  const w = Math.max(0.25, g + 0.07)
  return { ...base, parts: [cyl([0, 0, 0], [0, -0.05, 0], 0.01), cyl([-w, -0.05, 0], [w, -0.05, 0], 0.014)], sites: { l: { pos: [g, -0.05, 0], axis: [1, 0, 0] }, r: { pos: [-g, -0.05, 0], axis: [1, 0, 0] } } }
}

/** cable attachment hanging towards the pulley with its grips' midpoint on `center` */
function hangingPose(spec: ImplementSpec, center: V3, pulley: V3): ImplementPose {
  const rot = frameY(norm(sub(pulley, center)))
  const mid = scale(add(spec.sites.l.pos, spec.sites.r.pos), 0.5)
  return { id: spec.id, pos: sub(center, qrot(rot, mid)), rot }
}

/**
 * both hands onto a bar's sites, following the reference arm's bend (left solved, right mirrored): the elbow points
 * where the reference elbow does, turned `out` deg out from the side plus `push` (world)
 */
export function barArms(skel: Skeleton, q: Float64Array, spec: ImplementSpec, pose: ImplementPose, ref: Float64Array, o: { out: number; push?: V3; site?: string; pole?: V3; oblique?: number }) {
  const f = fk(skel, ref)
  const g = siteWorld(spec, pose, o.site ?? 'l')
  const hum = sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l'))
  const elbowDir = add(hum, qrot(f.rot[skel.seg.thorax2], [Math.sin(o.out * DEG) * Math.hypot(...hum), 0, 0]))
  const h = handFrame(skel, f, 'l')
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: h.palm, oblique: o.oblique }, { pole: o.pole ?? add(elbowDir, o.push ?? [0, 0, 0]), planeHint: 90 })
  mirrorArm(skel, q)
}

function pushBase(skel: Skeleton) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': PUSH.lumbar, 'thorax.flex': PUSH.thorax, 'neck.flex': -7, 'head.flex': -2, 'clavicle_*.prot': -3 })
  return q
}

function pushArms(skel: Skeleton, q: Float64Array, p: P, v: Pushdown, c: number) {
  const rope = v.rope
  const k = c * c
  setArm(skel, q, {
    flex: p.shoulderFlexion + PUSH.forward + PUSH.drift * (1 - c) * (1 - c),
    abd: rope ? ROPE_ARM.abd : 0,
    rot: rope ? lerp(ROPE_ARM.rot[0], ROPE_ARM.rot[1], c) : 0,
    elbow: lerp(v.elbow[1], v.elbow[0], c),
    pro: rope ? ROPE_ARM.pro * k : BAR_PRO,
    wrist: rope ? -ROPE_ARM.ext * k : 0,
    dev: rope ? ROPE_ARM.dev * k : 0,
  })
}

/** centre of pressure of body + attachment with the cable pulling it towards the pulley */
export function cablePressure(skel: Skeleton, f: FK, at: V3, pulley: V3, mass: number, kg = CABLE_KG) {
  const { force } = cableForce({ pulley, implement: 'x', point: [0, 0, 0], kg }, { id: 'x', pos: at, rot: qid() })
  return centerOfPressure(skel, f, [{ mass, pos: at }], [{ at, force }])[1]
}

function pushFrame(skel: Skeleton, q: Float64Array, p: P, v: Pushdown, c: number, sway = v.sway) {
  const pulley = v.pulley
  const barCenter = (f: FK): V3 => {
    const g = sitePos(skel, f, 'grip_l')
    return [0, g[1], g[2]]
  }
  const measure = (qq: Float64Array) => {
    const f = fk(skel, qq)
    // the cable pulls where the bar's rod meets it, 5 cm up the cable from the bar (as the balance gate measures)
    const c0 = barCenter(f)
    const at = v.rope ? ropeHandle(skel, f, pulley).pos : add(c0, scale(norm(sub(pulley, c0)), 0.05))
    return cablePressure(skel, f, at, pulley, 0.5) - v.target
  }
  const bal = standBalanced(skel, q, v.stance, { knee: PUSH.knee, tilt: PUSH.tilt }, measure, (qq) => pushArms(skel, qq, p, v, c), undefined, sway)
  let implements_: ImplementPose[]
  if (v.rope) implements_ = ropePoses(skel, fk(skel, q), pulley)
  else {
    const ref = Float64Array.from(q)
    const target = q[skel.dof['elbow_l.flex']]
    const fr = fk(skel, ref)
    const center = barCenter(fr)
    const fore = norm(sub(segPos(skel, fr, 'hand_l'), segPos(skel, fr, 'forearm_l')))
    // the hands close on the bar a little wider than the reference hands, which bends the elbows: slide the bar along
    // the forearms until the solved elbow is back on its keyed angle (lockout stays a lockout)
    let pose = hangingPose(v.bar!, center, pulley)
    const err = (d: number) => {
      q.set(ref)
      pose = hangingPose(v.bar!, add(center, scale(fore, d)), pulley)
      barArms(skel, q, v.bar!, pose, ref, { out: BAR_ABD, push: [0, 0, -0.1], oblique: BAR_OBLIQUE })
      return q[skel.dof['elbow_l.flex']] - target
    }
    err(root1d(err, -0.04, 0.08, { tol: 1e-4, scan: 3 }).x)
    implements_ = [pose]
  }
  return { bal, implements: implements_ }
}

export function pushdownContext(p: P, skel: Skeleton, tempo: Tempo): Pushdown {
  const rope = p.attachment === 'rope'
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const pulley: V3 = [0, HIGH, stance.midfoot[2] + PUSH_PULLEY_Z]
  const contacts = plantedContacts(skel, stance)
  const implements_: ImplementSpec[] = []
  let bar: ImplementSpec | undefined
  if (rope) {
    implements_.push(...ropeImplements())
    contacts.push(...ropeContacts())
  } else {
    bar = straightBar(p, skel)
    implements_.push(bar)
    contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: 'handle', grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'handle', grip: 'r' } })
  }
  implements_.push(stackSpec(pulley, false))
  const cables: Cable[] = [{ pulley, implement: 'handle', point: [0, 0, 0], kg: CABLE_KG }]
  const setup: Setup = { implements: implements_, contacts, tempo, symmetric: true, cables, balance: { point: 'com', over: 'midfoot', tol: PUSH_TOL } }
  const held = rope ? [...ROPE_IDS.ends] : ['handle']
  setup.rests = held.map((implement) => ({ implement, regions: ['thigh_l', 'thigh_r'], tol: -THIGH_CLEAR }))
  const v: Pushdown = { kind: 'pushdown', tempo, setup, stance, pulley, rope, bar, elbow: rope ? PUSH_ELBOW.rope : PUSH_ELBOW.bar, target: 0 }
  const bal = (u: number, sway?: Sway) => pushFrame(skel, pushBase(skel), p, v, phaseAt(u, tempo).c, sway).bal
  // the swing with the ankles still, then the band centred on it
  const still = limitSway(bal, Infinity, 64).ref
  const offs = Array.from({ length: 64 }, (_, i) => bal(i / 64, { ref: still, follow: 0 }).offset)
  v.target = Math.round(((Math.max(...offs) + Math.min(...offs)) / 2) * 1000) / 1000
  setup.balance!.target = v.target
  v.sway = limitSway(bal, PUSH_TOL - 0.004, 64)
  return v
}

export function samplePushdown(u: number, p: P, skel: Skeleton, v: Pushdown): Sampled {
  const q = pushBase(skel)
  const { implements: impl } = pushFrame(skel, q, p, v, phaseAt(u, v.tempo).c)
  return { q, implements: [...impl, { id: 'stack', pos: [0, 0, 0], rot: qid() }] }
}

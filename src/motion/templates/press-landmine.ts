import { bodyCapsules } from '../collide.ts'
import { attachHand, plantFoot, root1d, softBand, solveLegs, type FootTarget } from '../constraints.ts'
import { fk, localToWorld, segPos, sitePos } from '../fk.ts'
import { siteWorld, type ImplementSpec } from '../implements.ts'
import { FLOOR_MAT, floorMat, landmine, landmineBar, landminePose, LANDMINE } from '../implements/index.ts'
import { add, lerp, norm, qid, qrot, RAD, reject, sub, type V3 } from '../math.ts'
import { setDofs, setScapula, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { phaseAt, type Tempo } from '../timing.ts'
import { splitStance, standSplit } from './isolation.ts'
import { naturalCubic } from './press-body.ts'
import { setPelvis } from './standing.ts'
import type { Setup } from './types.ts'

// Landmine presses: one end of a loaded barbell in a floor pivot in front of the lifter (implements/portable-c.ts), the
// other end held at the shoulder (one hand, vertical-press 218 / 219) or both hands cupped round its tip at the upper
// chest (incline-press 136), pressed up and forward to straight arms. The bar is rigid about the pivot, so the hands
// travel on its arc: the bar's yaw is fixed by where the hands start and only its pitch changes (landminePose), and
// the arms are solved to the bar each frame. Lower body still: a staggered stance leaning slightly into the bar (the
// pressing side's foot back), or half kneeling on the pressing side's knee on a mat. The rear foot's heel stays down.
// Coaching standard (landmine press): start at the shoulder or upper chest, finish with the arm in line with the bar,
// no trunk rotation; ranges author judgment.

export type LandmineBase = 'split' | 'half_kneel'
export type LandmineHands = 'one' | 'two'

/**
 * Split stance: the front foot this far ahead of the rear one, m; front knee flexion, deg; trunk lean forward from
 * vertical, deg (into the bar). Half kneeling: rear thigh
 * behind vertical, rear knee, front knee, deg; the front foot's half spacing, m; the knee sinks this far into the mat, m
 */
export const LANDMINE_BODY = {
  split: { step: 0.36, frontKnee: 30, lean: 10 },
  kneel: { rearThigh: -2, rearKnee: 95, frontKnee: 90, frontX: 0.15, sink: 0.004 },
}

/**
 * One hand: the hand starts this far in front of the pressing shoulder joint, below it, and in towards the midline (a
 * share of the shoulder's distance from it), m; palm up and in under the sleeve. Two hands: the tip starts this far in
 * front of the sternum and above it (thorax2 frame), m, with the hands' grip centres this far from the tip and either side
 * of the bar, m. Elbow flexion at lockout, deg; plate per side, kg
 */
export const LANDMINE_PRESS = {
  one: { ahead: 0.22, below: 0.08, inward: 0.25 },
  two: { ahead: 0.3, up: 0.1, cup: { back: 0.06, side: 0.055 } },
  lock: 6,
  plateKg: { one: 10, two: 20 },
}

type S = 'l' | 'r'

export type LandmineCtx = {
  tempo: Tempo
  setup: Setup
  /** still lower body and trunk (the arms are solved per frame) */
  base: Float64Array
  hands: LandmineHands
  /** pressing hand (one hand) */
  work: S
  bar: ImplementSpec
  pivot: V3
  yaw: number
  pitch: [number, number]
  fixed: ImplementPose[]
  /** how obliquely the bar crosses each palm over the rep (press-body.ts wristSchedule) */
  oblique: Partial<Record<S, (c: number) => number>>
}

const other = (s: S): S => (s === 'l' ? 'r' : 'l')

/** the free arm hangs relaxed */
function freeArm(skel: Skeleton, q: Float64Array, s: S) {
  setDofs(skel, q, { [`shoulder_${s}.plane`]: 60, [`shoulder_${s}.elev`]: 12, [`elbow_${s}.flex`]: 15, [`forearm_${s}.pro`]: 20, [`grip_${s}.close`]: 0.3 })
  setScapula(skel, q, s)
}

/** staggered stance (isolation.ts), the `rear` foot back, the pelvis over the midfoot line leaning into the bar */
function splitBody(skel: Skeleton, rear: S): { q: Float64Array; feet: FootTarget[] } {
  const b = LANDMINE_BODY.split
  const st = splitStance(skel, other(rear), b.step)
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': 2, 'thorax.flex': 2, 'neck.flex': -6, 'head.flex': -2, 'grip_*.close': 1 })
  standSplit(skel, q, st, { frontKnee: b.frontKnee, tilt: b.lean - 4 })
  return { q, feet: st.feet }
}

const lowest = (skel: Skeleton, q: Float64Array, re: RegExp) =>
  Math.min(...bodyCapsules(skel, fk(skel, q)).filter((c) => re.test(c.region)).map((c) => Math.min(c.a[1], c.b[1]) - c.r))

/** half kneeling on the `rear` knee (on a mat), the other foot flat in front, trunk upright */
function kneelBody(skel: Skeleton, rear: S): { q: Float64Array; front: FootTarget } {
  const k = LANDMINE_BODY.kneel
  const front = other(rear)
  const sgn = front === 'l' ? 1 : -1
  const at = (y: number) => {
    const q = zeroQ(skel)
    setDofs(skel, q, {
      'lumbar.flex': 0,
      'thorax.flex': 2,
      'neck.flex': -4,
      [`hip_${rear}.flex`]: k.rearThigh,
      [`hip_${rear}.abd`]: 2,
      [`knee_${rear}.flex`]: k.rearKnee,
      [`ankle_${rear}.df`]: -10,
      [`toe_${rear}.flex`]: -30,
      'grip_*.close': 1,
    })
    setPelvis(skel, q, [0, y, 0], 0)
    return q
  }
  const y = root1d((yy) => lowest(skel, at(yy), new RegExp(`^(shank|thigh)_${rear}$`)) - (FLOOR_MAT.thick - k.sink), 0.3, 1.1, { tol: 1e-7 }).x
  const q = at(y)
  // the rear shin rises from the knee until the tucked toes rest on the floor
  const kd = skel.dof[`knee_${rear}.flex`]
  q[kd] = root1d((a) => {
    q[kd] = a
    return lowest(skel, q, new RegExp(`^foot_${rear}$`)) + k.sink
  }, 60, 150, { tol: 1e-7 }).x
  let foot!: FootTarget
  const z = root1d((zz) => {
    foot = plantFoot(skel, front, [sgn * k.frontX, 0, zz], 10)
    solveLegs(skel, q, [foot])
    return q[skel.dof[`knee_${front}.flex`]] - k.frontKnee
  }, 0.1, 0.9, { tol: 1e-6 }).x
  foot = plantFoot(skel, front, [sgn * k.frontX, 0, z], 10)
  solveLegs(skel, q, [foot])
  return { q, front: foot }
}

/** grip targets on the bar posed at `pose`: the pressing hand on the sleeve, or both hands cupped round the tip */
function grips(ctx: Pick<LandmineCtx, 'hands' | 'work' | 'bar'>, pose: ImplementPose) {
  const along = qrot(pose.rot, [1, 0, 0])
  if (ctx.hands === 'one') {
    const s = siteWorld(ctx.bar, pose, 'end_in')
    const medial: V3 = ctx.work === 'l' ? [-1, 0, 0] : [1, 0, 0]
    // the sleeve in the palm from underneath: palm up and in
    return [{ side: ctx.work, pos: s.pos, axis: s.axis!, palm: norm(reject(add([0, 1, 0], [medial[0] * 0.6, 0, 0]), along)) }]
  }
  // cup_l / cup_r: local +Z is the lifter's left at yaw 180; the palms press the sleeve from either side, thumbs
  // towards the pivot (the hand's axis level, along the bar seen from above)
  const ahead = norm([-along[0], 0, -along[2]])
  return (['l', 'r'] as const).map((side) => {
    const s = siteWorld(ctx.bar, pose, `cup_${side}`)
    const out = qrot(pose.rot, [0, 0, side === 'l' ? 1 : -1])
    return { side, pos: s.pos, axis: ahead, palm: norm(reject(sub([0, 0, 0], out), ahead)) }
  })
}

/** the wrist's full deviation range, so a scheduled obliquity is not fought by the solver's own saturation */
const JOINT_DEV: [number, number] = [-35, 20]
const RELAXED = { devBand: [-89, 89] as [number, number], limits: { dev: [-90, 90] as [number, number] } }

/** arms on the bar; `oblique` per side (deg), or `relaxed` to measure the deviation a grip needs */
function arms(skel: Skeleton, q: Float64Array, ctx: Pick<LandmineCtx, 'hands' | 'work' | 'bar'>, pose: ImplementPose, oblique: Partial<Record<S, number>> = {}, relaxed = false) {
  for (const g of grips(ctx, pose)) {
    const out = g.side === 'l' ? 1 : -1
    const o = oblique[g.side] ?? 0
    // elbows down and a little out under the bar
    attachHand(skel, q, g.side, { pos: g.pos, axis: g.axis, palm: g.palm, ...(o ? { oblique: o } : {}) }, { pole: [0.35 * out, -1, -0.2], planeHint: 70, ...(relaxed ? RELAXED : { devBand: JOINT_DEV }) })
  }
}

/**
 * The obliquity schedule of press-body.ts wristSchedule with a wider, softer comfort band: the natural deviation on the
 * sleeve swings from radial to ulnar and back mid-press, so the band's edge is eased over WRIST_SOFT deg and the knots
 * smoothed, keeping the deviation's jerk down. `devAt(c, oblique)` poses the arm (deviation limits relaxed) and returns
 * the deviation.
 */
const WRIST_BAND: [number, number] = [-28, 16]
const WRIST_SOFT = 12
function wristPlan(devAt: (c: number, oblique: number) => number, samples = 33): (c: number) => number {
  const cs = Array.from({ length: samples }, (_, k) => 0.5 - 0.5 * Math.cos((Math.PI * k) / (samples - 1)))
  const obl = cs.map((c) => {
    const nat = devAt(c, 0)
    const want = softBand(nat, WRIST_BAND, WRIST_SOFT)
    let [o0, e0] = [0, nat - want]
    if (Math.abs(e0) < 0.02) return 0
    let o1 = e0
    for (let it = 0; it < 8; it++) {
      const e1 = devAt(c, o1) - want
      if (Math.abs(e1) < 0.02) break
      const o2 = o1 - (e1 * (o1 - o0)) / (e1 - e0)
      ;[o0, e0, o1] = [o1, e1, o2]
    }
    return o1
  })
  for (let pass = 0; pass < 3; pass++) for (let i = 1, prev = obl[0]; i < obl.length - 1; i++) [prev, obl[i]] = [obl[i], (prev + 2 * obl[i] + obl[i + 1]) / 4]
  return naturalCubic(cs, obl)
}

const pitchAt = (ctx: Pick<LandmineCtx, 'pitch'>, c: number) => lerp(ctx.pitch[0], ctx.pitch[1], c)

/** the body at contraction c */
export function landmineFrame(skel: Skeleton, ctx: LandmineCtx, c: number): { q: Float64Array; bar: ImplementPose } {
  const q = Float64Array.from(ctx.base)
  const bar = landminePose(ctx.bar.id, ctx.pivot, ctx.yaw, pitchAt(ctx, c))
  arms(skel, q, ctx, bar, { l: ctx.oblique.l?.(c), r: ctx.oblique.r?.(c) })
  return { q, bar }
}

export function landmineContext(o: { hands: LandmineHands; base: LandmineBase; side: 'left' | 'right' }, skel: Skeleton, tempo: Tempo): LandmineCtx {
  const work: S = o.side === 'left' ? 'l' : 'r'
  // the pressing side's foot (or knee) back; two hands: the left foot forward
  const rear: S = o.hands === 'one' ? work : 'r'
  const contacts: Contact[] = []
  const fixed: ImplementPose[] = []
  const implements_: ImplementSpec[] = []
  let base: Float64Array
  if (o.base === 'split') {
    const s = splitBody(skel, rear)
    base = s.q
    for (const ft of s.feet) for (const n of ['heel', 'ball']) contacts.push({ site: `${n}_${ft.side}`, kind: 'planted', target: { world: add(ft.ankle, qrot(ft.rot, skel.data.sites[`${n}_${ft.side}`].local)) } })
  } else {
    const k = kneelBody(skel, rear)
    base = k.q
    const ft = k.front
    for (const n of ['heel', 'ball']) contacts.push({ site: `${n}_${ft.side}`, kind: 'planted', target: { world: add(ft.ankle, qrot(ft.rot, skel.data.sites[`${n}_${ft.side}`].local)) } })
    const f = fk(skel, base)
    contacts.push({ site: `ball_${rear}`, kind: 'planted', target: { world: sitePos(skel, f, `ball_${rear}`) } })
    const knee = segPos(skel, f, `tibia_${rear}`)
    const mat = floorMat({ id: 'mat', length: 0.45, width: 0.4 })
    implements_.push(mat)
    fixed.push({ id: 'mat', pos: [knee[0], 0, knee[2] - 0.1], rot: qid() })
  }
  if (o.hands === 'one') freeArm(skel, base, other(work))
  setDofs(skel, base, { 'grip_*.close': 1 })
  const f0 = fk(skel, base)
  const bar = landmineBar({ id: 'bar', plateKg: LANDMINE_PRESS.plateKg[o.hands], handle: 'none' })
  if (o.hands === 'two') {
    // both palms against the sleeve from either side, thumbs up, the hands side by side (the base sites' 3 cm either
    // side of the bar overlap the fists)
    const { back, side } = LANDMINE_PRESS.two.cup
    const tip = bar.sites.tip.pos[0]
    bar.sites.cup_l = { pos: [tip - back, 0, side], axis: [0, 1, 0] }
    bar.sites.cup_r = { pos: [tip - back, 0, -side], axis: [0, 1, 0] }
  }
  // start: where the grip site sits, and its distance from the pivot along the bar
  let start: V3, reach: number
  if (o.hands === 'one') {
    const sh = segPos(skel, f0, `humerus_${work}`)
    const p = LANDMINE_PRESS.one
    start = [sh[0] * (1 - p.inward), sh[1] - p.below, sh[2] + p.ahead]
    reach = bar.sites.end_in.pos[0]
  } else {
    const p = LANDMINE_PRESS.two
    start = localToWorld(skel, f0, 'thorax2', [0, p.up, p.ahead])
    start = [0, start[1], start[2]]
    reach = bar.sites.tip.pos[0]
  }
  const dy = start[1] - LANDMINE.pivot
  const pivot: V3 = [0, LANDMINE.pivot, start[2] + Math.sqrt(reach * reach - start[0] * start[0] - dy * dy)]
  const d = sub(start, pivot)
  const yaw = Math.atan2(d[0], d[2]) * RAD
  const p0 = Math.asin(dy / reach) * RAD
  const base1 = landmine({ id: 'landmine' })
  fixed.push({ id: base1.id, pos: [pivot[0], 0, pivot[2]], rot: qid() })
  const ctx: LandmineCtx = { tempo, setup: undefined as unknown as Setup, base, hands: o.hands, work, bar, pivot, yaw, pitch: [p0, p0], fixed, oblique: {} }
  // lockout: the pitch at which the (pressing) elbow is LANDMINE_PRESS.lock
  const elbow = (pitch: number) => {
    const q = Float64Array.from(base)
    arms(skel, q, ctx, landminePose(bar.id, pivot, yaw, pitch))
    return q[skel.dof[`elbow_${work}.flex`]] - LANDMINE_PRESS.lock
  }
  ctx.pitch = [p0, root1d(elbow, p0 + 1, 80, { tol: 1e-6, scan: 16 }).x]
  // the bar's angle to the forearm changes through the press: past the comfortable deviation it crosses the palm
  // obliquely, scheduled smoothly over the rep
  for (const side of o.hands === 'one' ? [work] : (['l', 'r'] as const)) {
    ctx.oblique[side] = wristPlan((c, obl) => {
      const q = Float64Array.from(base)
      arms(skel, q, ctx, landminePose(bar.id, pivot, yaw, pitchAt(ctx, c)), { [side]: obl }, true)
      return q[skel.dof[`wrist_${side}.dev`]]
    })
  }
  for (const g of grips(ctx, landminePose(bar.id, pivot, yaw, p0))) contacts.push({ site: `grip_${g.side}`, kind: 'grip', target: { implement: bar.id, grip: o.hands === 'one' ? 'end_in' : `cup_${g.side}` } })
  ctx.setup = { implements: [bar, base1, ...implements_], contacts, tempo, symmetric: false }
  return ctx
}

export function sampleLandmine(u: number, skel: Skeleton, ctx: LandmineCtx): Pose {
  const c = phaseAt(u, ctx.tempo).c
  const { q, bar } = landmineFrame(skel, ctx, c)
  return { q, implements: [bar, ...ctx.fixed], contacts: ctx.setup.contacts }
}

/** the bar's angle above horizontal along the rep, deg (for the tests) */
export const landminePitch = pitchAt

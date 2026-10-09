import { attachHand, legKinematics, plantFoot, root1d, writeLeg, type FootTarget } from '../../constraints.ts'
import { centerOfMass, fk, localToWorld, segPos, type FK } from '../../fk.ts'
import { siteWorld, type ImplementSpec } from '../../implements.ts'
import { plyoBox } from '../../implements/shared.ts'
import { bodyCapsules, restAgainst } from '../../collide.ts'
import { beltLever, beltSquat, hipBelt, BELT_SQUAT } from '../../implements/stations.ts'
import { landmine, landmineBar, landminePose, LANDMINE } from '../../implements/portable-c.ts'
import { around, band, bandAnchor, bandNode, bandPose, segmentPose } from '../../implements/bands.ts'
import { add, DEG, dist, lerp, qaxis, qmul, qrot, sub, type V3 } from '../../math.ts'
import { setDofs, setScapula, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import { hipsFor, makeStance, plantedContacts, setPelvis, stanceWidth, stand, standBalanced, type StanceSetup } from '../standing.ts'
import type { Setup } from '../types.ts'
import { mirrorArm } from './holds.ts'

// Free-standing tier C squats: the belt squat (the load hangs from a hip belt, the hands rest on a grab bar) and the
// landmine squat (both hands cupped round the bar's tip at the chest; the bar pivots on the floor ahead) and the band
// Spanish squat (a heavy band behind the knees, anchored ahead, lets the hips sit back over vertical shins) and the box
// pistol (one leg, the other reaching forward, down to touch a box behind) and the sissy squat (on the balls of the feet,
// the knees forward and the hips straight, a hand on an upright post).

type P = ParamsOf<'squat'>
type Variant = { tempo: Tempo; setup: Setup; sample: (u: number) => Pose }

function gaze(skel: Skeleton, q: Float64Array) {
  const d = skel.dof
  const pitch = q[d['pelvis.tilt']] + q[d['lumbar.flex']] + q[d['thorax.flex']]
  setDofs(skel, q, { 'neck.flex': -0.4 * pitch, 'head.flex': -0.2 * pitch })
}

/** both feet flat at height `y`, midfoot sites on z = 0 */
function raisedStance(skel: Skeleton, width: number, toeOut: number, y: number): StanceSetup {
  return { feet: [plantFoot(skel, 'l', [width / 2, 0, 0], toeOut, y), plantFoot(skel, 'r', [-width / 2, 0, 0], toeOut, y)], midfoot: [0, y, 0] }
}

// ---------- belt squat ----------

/**
 * Belt squat (author judgment; Kubo 2019 depth): the load hangs from a belt low on the hips, so the trunk stays nearly
 * upright (pelvis tilt `tilt` at the top and the bottom) while the knees bend to `knee` and the ankles balance the body
 * over the midfeet. The hands rest on the grab bar, placed where they reach it standing tall with the elbows soft and
 * at the bottom with the elbows bent; the chain from the belt's front ring keeps its length, so the lever turns to
 * follow the hips.
 */
const BELT = {
  knee: { quarter: 60, parallel: 100, full: 108 } as Record<P['depth'], number>,
  topKnee: 4,
  tilt: [2, 22] as [number, number],
  /** belt centre in the pelvis frame: low on the hips */
  at: [0, -0.045, 0.07] as V3,
  /** grab bar this far ahead of the shoulders standing tall, and the hands' reach to it there, m */
  bar: { ahead: 0.45, reach: 0.66 },
  /** the chain hangs this far down to the hook at the bottom of the rep, m (the hook just under the deck) */
  hookY: 0.14,
  toeOut: 15,
  dfRange: [-15, 40] as [number, number],
}

type Belt = {
  stance: StanceSetup
  frame: ImplementSpec
  lever: ImplementSpec
  belt: ImplementSpec
  knee: number
  /** chain length, m */
  chain: number
  pivot: V3
}

function beltArms(skel: Skeleton, q: Float64Array, frame: ImplementSpec) {
  setDofs(skel, q, { 'clavicle_*.prot': 4, 'clavicle_*.elev': 0, 'grip_*.close': 1 })
  const g = siteWorld(frame, { id: frame.id, pos: [0, 0, 0], rot: [0, 0, 0, 1] }, 'handle_l')
  // overhand on the bar: the palm faces down across the line from the shoulder (back and down with the arm low, down
  // with it raised), elbows down and a little out; the right arm mirrors the left
  const d = sub(g.pos, segPos(skel, fk(skel, q), 'humerus_l'))
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: [0, -d[2], d[1]] }, { pole: [0.5, -1, -0.3], planeHint: 85, wristBias: 0 })
  mirrorArm(skel, q)
}

function beltPose(skel: Skeleton, f: FK, spec: ImplementSpec): ImplementPose {
  return { id: spec.id, pos: localToWorld(skel, f, 'pelvis', BELT.at), rot: f.rot[skel.seg.pelvis] }
}

/** lever angle that keeps the chain from the belt ring to the hook at its length */
function leverDeg(b: Belt, ring: V3) {
  const rest = b.lever.sites.hook.pos
  const hook = (deg: number) => add(b.pivot, qrot(qaxis([1, 0, 0], deg * DEG), rest))
  return root1d((deg) => dist(hook(deg), ring) - b.chain, -5, 60, { tol: 1e-8, scan: 26 }).x
}

function beltBody(skel: Skeleton, b: Belt, s: number, arms: boolean) {
  const q = zeroQ(skel)
  const knee = lerp(BELT.topKnee, b.knee, s)
  const tilt = lerp(BELT.tilt[0], BELT.tilt[1], s)
  setDofs(skel, q, { 'lumbar.flex': 3 * s, 'thorax.flex': 2 * s })
  const upper = arms ? (qq: Float64Array) => beltArms(skel, qq, b.frame) : undefined
  standBalanced(skel, q, b.stance, { knee, tilt }, (qq) => centerOfMass(skel, fk(skel, qq))[2], upper, BELT.dfRange)
  gaze(skel, q)
  return q
}

export function belt(p: P, skel: Skeleton, tempo: Tempo): Variant {
  const deckTop = BELT_SQUAT.deck.top
  const stance = raisedStance(skel, stanceWidth(skel, p.stance === 'single_leg' ? 'shoulder' : p.stance), p.toeOut, deckTop)
  const knee = BELT.knee[p.depth]
  const probe: Belt = { stance, frame: beltSquat(), lever: beltLever(), belt: hipBelt(), knee, chain: 0, pivot: BELT_SQUAT.pivot }
  // grab bar: ahead of the shoulders, where the straight-ish arms reach it standing tall
  const top = fk(skel, beltBody(skel, probe, 0, false))
  const sh = segPos(skel, top, 'humerus_l')
  const barY = sh[1] - Math.sqrt(BELT.bar.reach ** 2 - BELT.bar.ahead ** 2)
  const frame = beltSquat({ bar: { y: barY, z: sh[2] + BELT.bar.ahead } })
  // chain: from the belt ring at the bottom of the rep straight down to the hook just under the deck
  const beltSpec = hipBelt()
  const low = fk(skel, beltBody(skel, { ...probe, frame }, 1, true))
  const ringLow = siteWorld(beltSpec, beltPose(skel, low, beltSpec), 'front').pos
  const hook: V3 = [0, BELT.hookY, ringLow[2]]
  const lever = beltLever({ hook })
  const b: Belt = { stance, frame, lever, belt: beltSpec, knee, chain: ringLow[1] - BELT.hookY, pivot: BELT_SQUAT.pivot }
  const contacts: Contact[] = [
    ...plantedContacts(skel, stance),
    { site: 'grip_l', kind: 'grip', target: { implement: frame.id, grip: 'handle_l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: frame.id, grip: 'handle_r' } },
  ]
  const setup: Setup = {
    implements: [frame, lever, beltSpec],
    contacts,
    tempo,
    symmetric: true,
    balance: { point: 'com', over: 'midfoot', tol: 0.025 },
  }
  return {
    tempo,
    setup,
    sample: (u) => {
      const s = 1 - phaseAt(u, tempo).c
      const q = beltBody(skel, b, s, true)
      const f = fk(skel, q)
      const bp = beltPose(skel, f, beltSpec)
      const deg = leverDeg(b, siteWorld(beltSpec, bp, 'front').pos)
      const lp: ImplementPose = { id: lever.id, pos: b.pivot, rot: qaxis([1, 0, 0], deg * DEG) }
      return { q, implements: [{ id: frame.id, pos: [0, 0, 0], rot: [0, 0, 0, 1] }, lp, bp], contacts }
    },
  }
}

// ---------- landmine squat ----------

/**
 * Landmine squat (author judgment, goblet squat ranges): knees and ankles keyed by depth as the goblet squat; the
 * bar's tip rides at the chest, cupped in both hands, so the trunk lean is solved each frame to keep the chest point
 * on the sphere the tip sweeps round the pivot. The pivot sits where the trunk stands `tilt` deg forward at the top:
 * the bar takes part of the weight, so the lifter leans into it.
 */
const MINE = {
  knee: { quarter: 60, parallel: 100, full: 112 } as Record<P['depth'], number>,
  df: { quarter: 12, parallel: 22, full: 27 } as Record<P['depth'], number>,
  top: { knee: 3, df: 5, tilt: 6 },
  /** the tip's cup point in the thorax frame: in front of the upper sternum, m */
  hold: [0, 0.07, 0.085] as V3,
  plateKg: 20,
  /** cupped hands' centres either side of the bar's axis, m */
  cup: 0.052,
}

type Mine = { stance: StanceSetup; bar: ImplementSpec; base: ImplementSpec; pivot: V3; reach: number; knee: number; df: number }

const holdPoint = (skel: Skeleton, f: FK) => localToWorld(skel, f, 'thorax2', add(skel.data.sites.sternum.local, MINE.hold))

/** both palms cupped round the tip (left solved, mirrored) */
function mineArms(skel: Skeleton, q: Float64Array, bar: ImplementSpec, pose: ImplementPose) {
  setDofs(skel, q, { 'clavicle_*.prot': 8, 'clavicle_*.elev': 2, 'grip_*.close': 1 })
  const g = siteWorld(bar, pose, 'cup_l')
  const palm = qrot(pose.rot, [0, 0.4, -1])
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm }, { pole: [0.1, -1, 0.3], planeHint: 60, wristBias: 30 })
  mirrorArm(skel, q)
}

function minePose(skel: Skeleton, f: FK, m: Mine): ImplementPose {
  const h = holdPoint(skel, f)
  const pitch = Math.asin(Math.max(-1, Math.min(1, (h[1] - m.pivot[1]) / m.reach))) / DEG
  return landminePose(m.bar.id, m.pivot, 180, pitch)
}

function mineBody(skel: Skeleton, m: Mine, s: number): { q: Float64Array; bar: ImplementPose } {
  const q = zeroQ(skel)
  const knee = lerp(MINE.top.knee, m.knee, s)
  const df = lerp(MINE.top.df, m.df, s)
  setDofs(skel, q, { 'lumbar.flex': 4 * s, 'thorax.flex': 3 * s, 'clavicle_*.prot': 8, 'grip_*.close': 1 })
  const hip = hipsFor(skel, m.stance, knee, df)
  root1d((tilt) => {
    setPelvis(skel, q, hip, tilt)
    return dist(holdPoint(skel, fk(skel, q)), m.pivot) - m.reach
  }, -20, 75, { tol: 1e-8, scan: 19 })
  stand(skel, q, m.stance, { knee, df, tilt: q[skel.dof['pelvis.tilt']] })
  const bar = minePose(skel, fk(skel, q), m)
  mineArms(skel, q, m.bar, bar)
  gaze(skel, q)
  return { q, bar }
}

export function landmineSquat(p: P, skel: Skeleton, tempo: Tempo): Variant {
  const stance = makeStance(skel, stanceWidth(skel, p.stance === 'single_leg' ? 'shoulder' : p.stance), p.toeOut)
  // the palms on the sides of the sleeve's end, MINE.cup apart, rather than overlapping round it
  const bar = landmineBar({ plateKg: MINE.plateKg })
  for (const [k, sz] of [['cup_l', 1], ['cup_r', -1]] as const) bar.sites[k] = { ...bar.sites[k], pos: [bar.sites[k].pos[0], 0, sz * MINE.cup] }
  const base = landmine()
  const cup = bar.sites.cup_l.pos
  const reach = Math.hypot(cup[0], cup[1])
  // the pivot ahead on the floor, where the tip meets the chest standing tall with the trunk at MINE.top.tilt
  const q = zeroQ(skel)
  stand(skel, q, stance, MINE.top)
  const h = holdPoint(skel, fk(skel, q))
  const py = LANDMINE.pivot
  const pivot: V3 = [0, py, h[2] + Math.sqrt(reach * reach - (h[1] - py) ** 2)]
  const m: Mine = { stance, bar, base, pivot, reach, knee: MINE.knee[p.depth], df: MINE.df[p.depth] }
  const contacts: Contact[] = [
    ...plantedContacts(skel, stance),
    { site: 'grip_l', kind: 'grip', target: { implement: bar.id, grip: 'cup_l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: bar.id, grip: 'cup_r' } },
  ]
  const setup: Setup = {
    implements: [base, bar],
    contacts,
    tempo,
    symmetric: true,
    rests: [{ implement: bar.id, regions: ['trunk', 'hand_l', 'hand_r'], tol: 15 }],
  }
  const basePose: ImplementPose = { id: base.id, pos: [0, 0, pivot[2]], rot: [0, 0, 0, 1] }
  return {
    tempo,
    setup,
    sample: (u) => {
      const s = 1 - phaseAt(u, tempo).c
      const { q, bar: bp } = mineBody(skel, m, s)
      return { q, implements: [basePose, bp], contacts }
    },
  }
}

// ---------- band Spanish squat ----------

/**
 * Spanish squat (author judgment): a heavy band loops behind both knees and runs to a post ahead at knee height, so the
 * shins stay near vertical (ankle `df`) while the hips sit back and down to `knee`; the band's pull at the knees holds
 * the body back, so the trunk stays more upright (`tilt`) than a free squat at that depth. Arms reach forward.
 */
const SPANISH = {
  knee: { quarter: 60, parallel: 95, full: 105 } as Record<P['depth'], number>,
  df: [3, 6] as [number, number],
  tilt: [3, 24] as [number, number],
  topKnee: 3,
  /** the post's face this far ahead of the midfeet, m */
  anchor: 0.95,
  /** band round each knee: centre in the tibia frame (left; x mirrored) and radii across and front-back, m */
  wrap: { at: [0.013, -0.045, -0.022] as V3, r: [0.07, 0.068] as [number, number] },
  toeOut: 8,
}

function forwardArms(skel: Skeleton, q: Float64Array, s: number) {
  setDofs(skel, q, { 'shoulder_*.plane': 90, 'shoulder_*.elev': 70 + 20 * s, 'elbow_*.flex': 6, 'forearm_*.pro': 40, 'grip_*.close': 0.2 })
  for (const k of ['l', 'r'] as const) setScapula(skel, q, k)
}

export function spanish(p: P, skel: Skeleton, tempo: Tempo): Variant {
  const stance = makeStance(skel, stanceWidth(skel, p.stance === 'single_leg' ? 'hip' : p.stance), Math.min(p.toeOut, SPANISH.toeOut))
  const knee = SPANISH.knee[p.depth]
  const body = (s: number) => {
    const q = zeroQ(skel)
    setDofs(skel, q, { 'lumbar.flex': 4 * s, 'thorax.flex': 2 * s })
    stand(skel, q, stance, { knee: lerp(SPANISH.topKnee, knee, s), df: lerp(SPANISH.df[0], SPANISH.df[1], s), tilt: lerp(SPANISH.tilt[0], SPANISH.tilt[1], s) })
    forwardArms(skel, q, s)
    gaze(skel, q)
    return q
  }
  const node = (k: 'l' | 'r') => ({ local: [k === 'l' ? SPANISH.wrap.at[0] : -SPANISH.wrap.at[0], SPANISH.wrap.at[1], SPANISH.wrap.at[2]] as V3, id: `knee_${k}` })
  const nodes = (f: FK) => (['l', 'r'] as const).map((k) => segmentPose(skel, f, node(k).id, `tibia_${k}`, node(k).local))
  // the hook at the band's height behind the knees standing tall
  const f0 = fk(skel, body(0))
  const h = (nodes(f0)[0].pos[1] + nodes(f0)[1].pos[1]) / 2
  const anchor = bandAnchor({ id: 'anchor', height: h, mount: 'post' })
  const anchorPose: ImplementPose = { id: 'anchor', pos: [0, 0, SPANISH.anchor], rot: qaxis([0, 1, 0], Math.PI) }
  const { r } = SPANISH.wrap
  // from the hook round the outside of the left knee, behind both knees, round the outside of the right knee, back
  const path = [
    { implement: 'anchor', site: 'hook' },
    ...around('knee_l', { r, from: 25, to: -125, axis: 'y' }),
    ...around('knee_r', { r, from: -55, to: -205, axis: 'y' }),
    { implement: 'anchor', site: 'hook' },
  ]
  const strip = band({ id: 'band', path, size: 'heavy' })
  const setup: Setup = {
    implements: [anchor, bandNode('knee_l'), bandNode('knee_r'), strip],
    contacts: plantedContacts(skel, stance),
    tempo,
    symmetric: true,
  }
  return {
    tempo,
    setup,
    sample: (u) => {
      const q = body(1 - phaseAt(u, tempo).c)
      return { q, implements: [anchorPose, ...nodes(fk(skel, q)), bandPose('band')], contacts: setup.contacts }
    },
  }
}

// ---------- box pistol ----------

/**
 * Box pistol (author judgment; single-leg squat ranges): the working foot planted, the other leg held straight out in
 * front (hip flexion `free.hip` from the top to the bottom, a little out to the side clear of the working thigh, toes up), arms reaching forward; the working knee bends to
 * `knee` while the trunk leans `tilt`, and the hips move fore-aft and sideways so the centre of mass stays over the
 * working midfoot. A box behind meets the glutes at the bottom (a touch, `sink` into the tread).
 */
const PISTOL = {
  knee: { quarter: 60, parallel: 92, full: 104 } as Record<P['depth'], number>,
  topKnee: 4,
  tilt: [6, 34] as [number, number],
  free: { hip: [38, 88] as [number, number], abd: 8, knee: 4, df: 8 },
  /** the working foot this far from the midline, m */
  foot: 0.09,
  toeOut: 6,
  box: { ahead: 0.06, sink: 0.006, width: 0.45, depth: 0.4 },
}

type Pistol = { work: 'l' | 'r'; foot: ReturnType<typeof plantFoot>; mid: V3; knee: number }

function pistolBody(skel: Skeleton, ps: Pistol, s: number): Float64Array {
  const q = zeroQ(skel)
  const free = ps.work === 'r' ? 'l' : 'r'
  const knee = lerp(PISTOL.topKnee, ps.knee, s)
  const tilt = lerp(PISTOL.tilt[0], PISTOL.tilt[1], s)
  setDofs(skel, q, { 'lumbar.flex': 8 * s, 'thorax.flex': 4 * s })
  setDofs(skel, q, { [`hip_${free}.flex`]: lerp(PISTOL.free.hip[0], PISTOL.free.hip[1], s), [`hip_${free}.abd`]: PISTOL.free.abd, [`knee_${free}.flex`]: PISTOL.free.knee, [`ankle_${free}.df`]: PISTOL.free.df })
  forwardArms(skel, q, s)
  const place = (x: number, y: number, z: number) => {
    setPelvis(skel, q, [x, y, z], tilt)
    const f = fk(skel, q)
    const leg = legKinematics(skel, ps.work, f.pos[skel.seg[`femur_${ps.work}`]], f.rot[skel.seg.pelvis], ps.foot)
    writeLeg(skel, q, ps.work, leg)
    return leg.knee
  }
  const at = (x: number, z: number) => {
    const y = root1d((y) => place(x, y, z) - knee, 0.4, 1.2, { tol: 1e-9, scan: 16 }).x
    place(x, y, z)
    const c = centerOfMass(skel, fk(skel, q))
    return { y, e: [c[0] - ps.mid[0], c[2] - ps.mid[2]] }
  }
  // Newton on the pelvis x and z so the centre of mass sits over the working midfoot
  let x = ps.mid[0] * 0.8, z = ps.mid[2] - 0.05
  for (let k = 0; k < 8; k++) {
    const r0 = at(x, z)
    if (Math.hypot(r0.e[0], r0.e[1]) < 1e-7) break
    const h = 1e-4
    const rx = at(x + h, z), rz = at(x, z + h)
    const [a, b, c, d] = [(rx.e[0] - r0.e[0]) / h, (rz.e[0] - r0.e[0]) / h, (rx.e[1] - r0.e[1]) / h, (rz.e[1] - r0.e[1]) / h]
    const det = a * d - b * c
    x -= (d * r0.e[0] - b * r0.e[1]) / det
    z -= (-c * r0.e[0] + a * r0.e[1]) / det
  }
  at(x, z)
  gaze(skel, q)
  return q
}

export function pistol(p: P, skel: Skeleton, tempo: Tempo): Variant {
  const work = p.side === 'left' ? 'l' : 'r'
  const foot = plantFoot(skel, work, [work === 'l' ? PISTOL.foot : -PISTOL.foot, 0, 0], PISTOL.toeOut)
  const mid = add(foot.ankle, qrot(foot.rot, skel.data.sites[`midfoot_${work}`].local))
  const ps: Pistol = { work, foot, mid, knee: PISTOL.knee[p.depth] }
  // the box behind the working heel whose tread meets the glutes at the bottom
  const f = fk(skel, pistolBody(skel, ps, 1))
  const hip = localToWorld(skel, f, 'pelvis', [0, 0, 0])
  const caps = bodyCapsules(skel, f).filter((c) => c.region === 'trunk' || c.region.startsWith('thigh_'))
  const { width, depth } = PISTOL.box
  const centre: V3 = [mid[0], 0, hip[2] + PISTOL.box.ahead - depth / 2]
  const probe = restAgainst(caps, { shape: 'box', center: [centre[0], hip[1] - 0.3, centre[2]], size: [width, 0.02, depth] }, [0, -1, 0], -PISTOL.box.sink)
  const box = plyoBox({ id: 'box', height: probe.center[1] + 0.01, width, depth })
  // the balance gate's support point: the working midfoot, carried as a site on the (fixed) box
  box.sites.stance = { pos: sub(mid, centre) }
  const contacts: Contact[] = plantedContacts(skel, { feet: [foot], midfoot: mid })
  const setup: Setup = {
    implements: [box],
    contacts,
    tempo,
    symmetric: false,
    balance: { point: 'com', over: { implement: 'box', sites: ['stance'] }, tol: 0.01 },
    rests: [{ implement: 'box', regions: ['trunk', `thigh_${work}`], tol: 15 }],
  }
  const boxPose: ImplementPose = { id: 'box', pos: centre, rot: [0, 0, 0, 1] }
  return { tempo, setup, sample: (u) => ({ q: pistolBody(skel, ps, 1 - phaseAt(u, tempo).c), implements: [boxPose], contacts }) }
}

// ---------- sissy squat ----------

/**
 * Sissy squat (author judgment; knee extension at long quad length, Larsen 2025): up on the balls of the feet (heels
 * `pitch` deg up, rising as the knees travel forward), the hips held straight (`hip` flexion) so the body is one line
 * from the knees to the shoulders, leaning back as the knees bend to `knee`. The ankles put the centre of mass `com` m
 * behind the balls (over the forefoot); the left hand holds an upright post ahead and to the side for balance (as the
 * leaning lateral raise's post), the right arm reaches forward.
 */
const SISSY = {
  knee: { quarter: 60, parallel: 90, full: 110 } as Record<P['depth'], number>,
  topKnee: 5,
  pitch: [14, 42] as [number, number],
  hip: [4, -2] as [number, number],
  com: -0.015,
  /** feet this far from the midline, toes out, deg */
  foot: 0.11,
  toeOut: 6,
  /** the post's grip from the left shoulder joint midway through the rep: out, ahead and down, m */
  post: { out: 0.18, ahead: 0.45, down: 0.2 },
  floorTol: 50,
  /** the post hand's comfortable wrist deviation: wide, so the grip never saturates and snaps as the arm folds, deg */
  devBand: [-32, 18] as [number, number],
}

type Sissy = { balls: V3[]; yaws: number[]; knee: number; post?: ImplementSpec }

function ballFoot(skel: Skeleton, side: 'l' | 'r', ball: V3, pitch: number, yaw: number): FootTarget {
  const rot = qmul(qaxis([0, 1, 0], (side === 'l' ? yaw : -yaw) * DEG), qaxis([1, 0, 0], pitch * DEG))
  return { side, rot, ankle: sub(ball, qrot(rot, skel.data.sites[`ball_${side}`].local)) }
}

const POST_POSE: ImplementPose = { id: 'post', pos: [0, 0, 0], rot: [0, 0, 0, 1] }

function sissyArms(skel: Skeleton, q: Float64Array, v: Sissy | null, s: number) {
  // the free arm stays about level as the trunk leans back
  setDofs(skel, q, { 'shoulder_r.plane': 90, 'shoulder_r.elev': 70 - 35 * s, 'elbow_r.flex': 10, 'forearm_r.pro': 40, 'grip_r.close': 0.2 })
  setScapula(skel, q, 'r')
  if (!v) {
    setDofs(skel, q, { 'shoulder_l.plane': 20, 'shoulder_l.elev': 60, 'elbow_l.flex': 30, 'grip_l.close': 0.3 })
    setScapula(skel, q, 'l')
    return
  }
  const g = siteWorld(v.post!, POST_POSE, 'h')
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: [-1, 0, 0.2] }, { pole: [0.4, -1, -0.2], planeHint: 60, devBand: SISSY.devBand })
  q[skel.dof['grip_l.close']] = 1
}

function sissyBody(skel: Skeleton, v: Sissy, s: number, post: boolean): Float64Array {
  const q = zeroQ(skel)
  const knee = lerp(SISSY.topKnee, v.knee, s)
  const hipFlex = lerp(SISSY.hip[0], SISSY.hip[1], s)
  const pitch = lerp(SISSY.pitch[0], SISSY.pitch[1], s)
  const feet = (['l', 'r'] as const).map((side, i) => ballFoot(skel, side, v.balls[i], pitch, v.yaws[i]))
  const ballZ = v.balls[0][2]
  const ls = skel.segments[skel.seg.tibia_l].length, lt = skel.segments[skel.seg.femur_l].length
  const ankle = feet[0].ankle
  // sagittal chain from the ankle: the shin `shin` deg forward of vertical, the thigh `knee` deg back from it, the
  // pelvis tilted so the hip flexes `hipFlex`; the legs are then solved to the feet exactly
  const place = (shin: number) => {
    const a = shin * DEG, t = (shin - knee) * DEG
    const hip: V3 = [0, ankle[1] + ls * Math.cos(a) + lt * Math.cos(t), ankle[2] + ls * Math.sin(a) + lt * Math.sin(t)]
    setPelvis(skel, q, hip, hipFlex + (shin - knee))
    const f = fk(skel, q)
    for (const foot of feet) writeLeg(skel, q, foot.side, legKinematics(skel, foot.side, f.pos[skel.seg[`femur_${foot.side}`]], f.rot[skel.seg.pelvis], foot))
    for (const side of ['l', 'r'] as const) q[skel.dof[`toe_${side}.flex`]] = -Math.min(55, pitch)
  }
  const balance = () => root1d((shin) => {
    place(shin)
    return centerOfMass(skel, fk(skel, q))[2] - ballZ - SISSY.com
  }, -10, 85, { tol: 1e-9, scan: 19 }).x
  sissyArms(skel, q, null, s)
  let shin = balance()
  if (post) {
    // the arm on the post moves the centre of mass a little: balance again with it there
    for (let k = 0; k < 2; k++) {
      sissyArms(skel, q, v, s)
      shin = balance()
    }
    place(shin)
    sissyArms(skel, q, v, s)
  } else place(shin)
  gaze(skel, q)
  return q
}

export function sissy(p: P, skel: Skeleton, tempo: Tempo): Variant {
  const balls: V3[] = (['l', 'r'] as const).map((side) => {
    const f = plantFoot(skel, side, [side === 'l' ? SISSY.foot : -SISSY.foot, 0, 0], SISSY.toeOut)
    return add(f.ankle, qrot(f.rot, skel.data.sites[`ball_${side}`].local))
  })
  const v: Sissy = { balls, yaws: [SISSY.toeOut, SISSY.toeOut], knee: SISSY.knee[p.depth] }
  // the post's grip out, ahead of and below the left shoulder midway through the rep
  const sh = segPos(skel, fk(skel, sissyBody(skel, v, 0.5, false)), 'humerus_l')
  const grip: V3 = [sh[0] + SISSY.post.out, sh[1] - SISSY.post.down, sh[2] + SISSY.post.ahead]
  const mid = scaleV(add(balls[0], balls[1]), 0.5)
  v.post = {
    id: 'post',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [{ shape: 'cylinder', a: [grip[0], 0, grip[2]], b: [grip[0], 2.1, grip[2]], r: 0.016 }],
    // `balls`: the balance gate's support point, the balls' midpoint, carried on the (fixed) post
    sites: { h: { pos: grip, axis: [0, 1, 0] }, balls: { pos: mid } },
  }
  const contacts: Contact[] = [
    ...balls.map((b, i): Contact => ({ site: `ball_${i ? 'r' : 'l'}`, kind: 'planted', target: { world: b } })),
    { site: 'grip_l', kind: 'grip', target: { implement: 'post', grip: 'h' } },
  ]
  const setup: Setup = {
    implements: [v.post],
    contacts,
    tempo,
    symmetric: false,
    balance: { point: 'com', over: { implement: 'post', sites: ['balls'] }, tol: 0.02, target: SISSY.com },
    // up on the balls the rigid forefoot capsule dips under the floor where the real toes lie flat (as the lunge's rear
    // foot on its ball, REAR_FLOOR_TOL; lead decision)
    tolerances: { floor: SISSY.floorTol },
  }
  return { tempo, setup, sample: (u) => ({ q: sissyBody(skel, v, 1 - phaseAt(u, tempo).c, true), implements: [POST_POSE], contacts }) }
}

const scaleV = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]

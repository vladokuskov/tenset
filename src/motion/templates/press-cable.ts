import { attachHand, handFrame } from '../constraints.ts'
import { bodyCapsules, segmentDistance, type Capsule } from '../collide.ts'
import { fk, segPos, type FK } from '../fk.ts'
import type { ImplementSpec } from '../implements.ts'
import { band, bandAnchor, bandHandle, bandNode, bandPose, poseHandle } from '../implements/index.ts'
import { add, dot, lerp, norm, qid, qrot, scale, sub, type V3 } from '../math.ts'
import { mirrorArm } from './isolation.ts'
import { shoulderRhythm, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { phaseAt, type Tempo } from '../timing.ts'
import { crossoverBody, crossoverContext, handlePoses, stillSplit, type CrossoverCtx } from './crossover.ts'
import type { ParamsOf } from './schemas.ts'
import type { Setup } from './types.ts'

// Standing chest press (horizontal-press, posture standing): split stance with the front knee soft and the trunk
// leaning a little into the press, the hands pushed on a straight level line from beside the chest forward and together
// at chest height, elbows from back and out (~45-60 deg) to soft at lockout. Cable: a D-handle on each stack of a
// crossover behind the lifter, pulleys a little above the shoulders; the body leans against the pulls (the crossover
// rig's still split stance, F3). Band: a band anchored on a post behind at chest height, its ends on two handles; the
// strip passes the sides of the chest under the arms.
// Also the band rig for the band fly (fly.ts).

type P = ParamsOf<'horizontal-press'>

/** cable: the two pulleys behind the lifter (it steps forward from between the towers), a little above the shoulders
 * and a little wider, so the cables run back and up from the handles over the upper arms at the bottom and past the
 * forearms at lockout; band: the post's hook height (chest). Height, half span and z, m */
const PULLEY = { y: 1.62, x: 0.7, z: -0.3 }
const BAND_HOOK_Y = 1.4
const CABLE_KG = 4
/** split stance: step length, front knee and pelvis tilt (lean into the press), deg */
const SPLIT = { step: 0.4, frontKnee: 40, tilt: 14 }
const TRUNK = { 'lumbar.flex': 2, 'thorax.flex': 3, 'neck.flex': -8, 'head.flex': -4 }
/**
 * Hand path from the thorax (thorax2 origin, world axes, m; left hand): a straight level line at chest height, whatever
 * the lean, from beside the chest (just in front of it, ~10 cm outside its side) to lockout with the hands ~17 cm apart,
 * as far forward as `reach` from the shoulder joint (elbows ~10 deg). The arm is solved to it (attachHand) with the
 * elbow pole out, down and back, so the upper arm sits ~45-60 deg from the trunk at the bottom
 */
const PATH = { bottom: [0.27, -0.01, 0.29] as V3, top: { x: 0.085, reach: 0.706 } }
const POLE: { bottom: V3; top: V3 } = { bottom: [0.8, -0.45, -0.4], top: [0.6, -0.8, 0] }
/** scapulae retracted at the start and protracted at lockout (clavicle protraction, deg); wrist extension, deg */
const GIRDLE = { prot: [-8, 6] }
const WRIST = 10
/** a first guess of the humerus (plane, elevation) for the girdle, refined by one re-solve */
const GUESS = { plane: [-10, 80], elev: [55, 80] }
/** band: the post behind the lifter (hook z, m) and where the strip passes the chest: the trunk's frontal plane (thorax
 * frame z) and the half width it clears there, m */
const BAND_POST_Z = -0.75
const SIDE = { z: 0.06, half: 0.2 }

export type StandingPressCtx = { kind: 'standing'; tempo: Tempo; setup: Setup; x: CrossoverCtx; band?: BandRig }

export function unsupportedStanding(p: P): string | null {
  if (p.implement !== 'cable' && p.implement !== 'band') return `${p.implement} standing`
  if (p.laterality !== 'bilateral') return p.laterality
  if (p.grip !== 'pronated') return `grip ${p.grip}`
  if (p.stance !== 'split') return `stance ${p.stance ?? 'hip'}`
  return null
}

/** both arms at contraction c (left solved to the path, right mirrored) */
function pressArms(skel: Skeleton, q: Float64Array, c: number) {
  const d = skel.dof
  const girdle = (plane: number, elev: number) => {
    const g = shoulderRhythm(elev, plane)
    q[d['clavicle_l.elev']] = g.elev
    q[d['clavicle_l.prot']] = g.prot + lerp(GIRDLE.prot[0], GIRDLE.prot[1], c)
  }
  // the girdle moves the shoulder joint, so the lockout point is found after it
  const solve = () => {
    const f = fk(skel, q)
    const o = segPos(skel, f, 'thorax2')
    const sh = sub(segPos(skel, f, 'humerus_l'), o)
    const [dx, dy] = [PATH.top.x - sh[0], PATH.bottom[1] - sh[1]]
    const top: V3 = [PATH.top.x, PATH.bottom[1], sh[2] + Math.sqrt(PATH.top.reach ** 2 - dx * dx - dy * dy)]
    const pole = qrot(f.rot[skel.seg.thorax2], norm(lerpV(POLE.bottom, POLE.top, c)))
    attachHand(skel, q, 'l', { pos: add(o, lerpV(PATH.bottom, top, c)), axis: norm([1, 0, 0.4 * (1 - c)]), palm: norm([0, -0.15, 1]) }, { pole, wristBias: WRIST, planeHint: 40, devBand: [-35, 20] })
  }
  q[d['grip_l.close']] = 1
  girdle(lerp(GUESS.plane[0], GUESS.plane[1], c), lerp(GUESS.elev[0], GUESS.elev[1], c))
  solve()
  girdle(q[d['shoulder_l.plane']], q[d['shoulder_l.elev']])
  solve()
  mirrorArm(skel, q)
}

const lerpV = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

// ---------- band rig (shared with the band fly) ----------

/** how the strip gets past the arm on its way back to the hook: under the elbow and the armpit (presses), or round the
 * outside of the elbow and the back of the shoulder (fly, the arms near shoulder height) */
export type BandRoute = 'under' | 'outside'
export type BandRig = { handles: [ImplementSpec, ImplementSpec]; anchor: ImplementPose; hook: V3; route: BandRoute }

/** band handles, a post anchor behind the lifter at `hook`, two nodes a side where the strip passes the arm, and the
 * band through them */
export function bandRig(hook: V3, route: BandRoute = 'under'): { rig: BandRig; specs: ImplementSpec[] } {
  const handles: [ImplementSpec, ImplementSpec] = [bandHandle({ id: 'handle_l' }), bandHandle({ id: 'handle_r' })]
  const anchorSpec = bandAnchor({ height: hook[1], mount: 'post' })
  const anchor: ImplementPose = { id: anchorSpec.id, pos: [hook[0], 0, hook[2] - anchorSpec.sites.hook.pos[2]], rot: qid() }
  // from the ring towards the hook on the left, back out to the ring on the right
  const left = route === 'under' ? ['arm_l', 'side_l'] : ['wrist_l', 'arm_l', 'side_l']
  const nodes = [...left, ...left.map((id) => id.replace('_l', '_r')).reverse()]
  const half = left.length
  const specs = [
    ...handles,
    anchorSpec,
    ...nodes.map((id) => bandNode(id)),
    band({ path: [{ implement: 'handle_l', site: 'ring' }, ...nodes.slice(0, half), { implement: anchorSpec.id, site: 'hook' }, ...nodes.slice(half), { implement: 'handle_r', site: 'ring' }] }),
  ]
  return { rig: { handles, anchor, hook, route }, specs }
}

/**
 * Where the strip passes the side of the chest on its way from a handle's ring back to the hook: on the straight line
 * where it crosses the trunk's frontal plane, pushed out to clear the chest when the line would cut through it (a
 * smooth max, so the strip wraps without a jump)
 */
export function passSide(skel: Skeleton, f: FK, ring: V3, hook: V3, s: 'l' | 'r'): V3 {
  const thorax = f.rot[skel.seg.thorax2]
  const o = segPos(skel, f, 'thorax2')
  const local = (w: V3) => qrot([-thorax[0], -thorax[1], -thorax[2], thorax[3]], sub(w, o))
  const [r, h] = [local(ring), local(hook)]
  const t = Math.max(0.01, Math.min(0.99, (r[2] - SIDE.z) / (r[2] - h[2])))
  const on = add(r, scale(sub(h, r), t))
  const x = s === 'l' ? on[0] : -on[0]
  const out = (x + SIDE.half + Math.hypot(x - SIDE.half, 0.02)) / 2
  return add(o, qrot(thorax, [s === 'l' ? out : -out, on[1], on[2]]))
}

/** the strip keeps this far off the arm's capsules, m */
const ARM_CLEAR = 0.006
const ARM_REGIONS = (s: 'l' | 'r') => [`upperarm_${s}`, `forearm_${s}`, `girdle_${s}`]

/** the strip's wrap nodes: how close (m) the straight run comes to the arm before they start to move to their wrap
 * points, and how far those sit from the elbow and shoulder joint centres */
const WRAP = { near: 0.03, elbow: 0.065, wrist: 0.05, outside: 0.08, shoulder: 0.1 }
export const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}

/** closest approach of the run a-b to the capsules, m */
export function runClearance(caps: Capsule[], a: V3, b: V3): number {
  let m = Infinity
  for (const c of caps) m = Math.min(m, segmentDistance(a, b, c.a, c.b).d - c.r)
  return m
}

/**
 * A path point between `a` and `b` whose two runs clear `caps`: `base` when they already do, else `base` moved along
 * `dir` just far enough (bisection, so it follows the arm smoothly from frame to frame). `a` may depend on the point (a
 * handle's ring turns towards it)
 */
export function clearNode(caps: Capsule[], a: V3 | ((p: V3) => V3), b: V3, base: V3, dir: V3, clear = ARM_CLEAR, max = 0.4): V3 {
  const at = (k: number) => add(base, scale(dir, k))
  const from = typeof a === 'function' ? a : () => a
  const ok = (k: number) => Math.min(runClearance(caps, from(at(k)), at(k)), runClearance(caps, at(k), b)) >= clear
  if (ok(0)) return base
  let lo = 0, hi = 0.02
  while (!ok(hi) && hi < max) [lo, hi] = [hi, hi + 0.02]
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2
    if (ok(m)) hi = m
    else lo = m
  }
  return at(hi)
}

/** the point of the run a-b closest to p */
export function closestOn(a: V3, b: V3, p: V3): V3 {
  const ab = sub(b, a)
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)))
  return add(a, scale(ab, t))
}

/**
 * Handle, node and band poses for a body pose (the anchor last). Each node sits on the straight run when that keeps
 * clear of the arm and moves to its wrap point as the run nears the arm (a smooth blend on the run's clearance, so it
 * never jumps between passing one side of the arm and the other), then only as far on as the arm's capsules need,
 * checked every frame. Under: the strip runs from the ring under the elbow to the side of the chest, then to the hook.
 * Outside: round the outside of the elbow and over the back of the shoulder to the hook.
 */
export function bandRigPoses(skel: Skeleton, q: Float64Array, rig: BandRig): ImplementPose[] {
  const f = fk(skel, q)
  const caps = bodyCapsules(skel, f)
  const T = (v: V3) => qrot(f.rot[skel.seg.thorax2], v)
  const out: ImplementPose[] = []
  for (const [k, s] of (['l', 'r'] as const).entries()) {
    const h = handFrame(skel, f, s)
    const arm = caps.filter((c) => ARM_REGIONS(s).includes(c.region))
    const ring0 = poseHandle(rig.handles[k], 'c', h.pos, h.axis, rig.hook).pos
    // the ring turns towards where the strip leaves it
    const ringTo = (p: V3) => poseHandle(rig.handles[k], 'c', h.pos, h.axis, p).pos
    const elbow = segPos(skel, f, `forearm_${s}`)
    const shoulder = segPos(skel, f, `humerus_${s}`)
    const lat = T([s === 'l' ? 1 : -1, 0, 0])
    let first: V3, second: V3
    let extra: V3 | undefined
    if (rig.route === 'under') {
      const down = T([0, -1, 0])
      const side0 = passSide(skel, f, ring0, rig.hook, s)
      const w = smooth((WRAP.near - runClearance(arm, ring0, side0)) / WRAP.near)
      const base = lerpV(closestOn(ring0, side0, elbow), add(elbow, scale(down, WRAP.elbow)), w)
      ;[first, second] = [base, side0]
      // the side node first: dropping under the armpit lets the arm node stay near the elbow
      for (let it = 0; it < 2; it++) {
        second = clearNode(arm, first, rig.hook, side0, down)
        first = clearNode(arm, ringTo, second, base, down)
      }
    } else {
      // away from the trunk across the humerus at the elbow; lateral, back and a little up at the shoulder
      const hum = norm(sub(elbow, shoulder))
      const outE = norm(sub(lat, scale(hum, dot(lat, hum))))
      const back = norm(add(add(lat, T([0, 0.25, -0.8])), scale(hum, -dot(add(lat, T([0, 0.25, -0.8])), hum))))
      // the straight run nears the arm, or (hands in front) cuts through the chest
      const body = [...arm, ...caps.filter((c) => c.region === 'trunk')]
      const w = smooth((WRAP.near - runClearance(body, ring0, rig.hook)) / WRAP.near)
      const eBase = lerpV(closestOn(ring0, rig.hook, elbow), add(elbow, scale(outE, WRAP.outside)), w)
      const sBase = lerpV(closestOn(ring0, rig.hook, shoulder), add(shoulder, scale(back, WRAP.shoulder)), w)
      const wrist = segPos(skel, f, `hand_${s}`)
      const fore = norm(sub(wrist, elbow))
      const outW = norm(sub(lat, scale(fore, dot(lat, fore))))
      extra = lerpV(closestOn(ring0, rig.hook, wrist), add(wrist, scale(outW, WRAP.wrist)), w)
      ;[first, second] = [eBase, sBase]
    }
    out.push(
      poseHandle(rig.handles[k], 'c', h.pos, h.axis, extra ?? first),
      ...(extra ? [{ id: `wrist_${s}`, pos: extra, rot: qid() }] : []),
      { id: `arm_${s}`, pos: first, rot: qid() },
      { id: `side_${s}`, pos: second, rot: qid() },
    )
  }
  out.push(bandPose(), rig.anchor)
  return out
}

// ---------- context ----------

export function standingContext(p: P, skel: Skeleton, tempo: Tempo): StandingPressCtx {
  const isBand = p.implement === 'band'
  const hook: V3 = [0, BAND_HOOK_Y, BAND_POST_Z]
  const pulleys = isBand ? { l: hook, r: hook } : { l: [PULLEY.x, PULLEY.y, PULLEY.z] as V3, r: [-PULLEY.x, PULLEY.y, PULLEY.z] as V3 }
  const x = crossoverContext(skel, {
    tempo,
    pulleys,
    crossed: false,
    kg: isBand ? 0 : CABLE_KG,
    stance: { kind: 'split', front: 'l', step: SPLIT.step, frontKnee: SPLIT.frontKnee, tilt: isBand ? SPLIT.tilt / 2 : SPLIT.tilt },
    trunk: TRUNK,
    facing: [0, 0, 1],
  })
  x.sway = stillSplit(skel, x, () => zeroQ(skel), (u) => (q) => pressArms(skel, q, phaseAt(u, tempo).c))
  let band: BandRig | undefined
  if (isBand) {
    const r = bandRig(hook)
    band = r.rig
    // the band handles take the cable handles' ids, so the grip contacts stand; no tower, no cable pull
    x.setup = { ...x.setup, implements: r.specs, cables: undefined }
  }
  return { kind: 'standing', tempo, setup: x.setup, x, band }
}

export function sampleStanding(u: number, skel: Skeleton, ctx: StandingPressCtx): Pose {
  const c = phaseAt(u, ctx.tempo).c
  const q = zeroQ(skel)
  crossoverBody(skel, ctx.x, q, (qq) => pressArms(skel, qq, c), ctx.x.sway)
  const implements_ = ctx.band
    ? bandRigPoses(skel, q, ctx.band)
    : [...handlePoses(skel, ctx.x, q), { id: ctx.x.crossover.id, pos: [0, 0, 0] as V3, rot: qid() }]
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

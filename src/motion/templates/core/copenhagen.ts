import { attachHand } from '../../constraints.ts'
import { bodyCapsules } from '../../collide.ts'
import { fk } from '../../fk.ts'
import type { ImplementSpec } from '../../implements.ts'
import { palmRest } from '../../implements/core.ts'
import { flatBench, floorMat } from '../../implements/shared.ts'
import { dls } from '../../ik.ts'
import { add, dist, lerp, qaxis, qfromBasis, qid, qrot, type Quat, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import type { Setup } from '../types.ts'
import { MAT_TOP, SINK, segPosOf, toWorld } from './floor.ts'

// Copenhagen plank (538) as a breathing hold, after the side plank (core/plank.ts): on the bottom forearm, elbow under
// the shoulder, the working (top) leg straight with the inside of its lower shin across a flat bench, the hips lifted
// so the body runs in one line from the shoulder to the top ankle; the bottom leg hangs towards the floor below the
// bench (the short-lever version the cues describe) and the free arm reaches straight up. The top leg's adductors hold
// the body up. The supports stay put; the breath only moves the shoulder girdle and the neck (the exhale braces with
// the highlight pulse). Research (motion-authoring, holds): neutral spine, hips in line; ranges are author judgment.

type P = ParamsOf<'hold'>

/** flat bench pad height, m; the top shin sinks this far into it */
export const BENCH_TOP = 0.43
/** the bottom foot hangs this far above the floor, m */
const HANG = 0.03
/** the hanging bottom leg's knee, deg: bent, so its foot drops near the hips instead of under the bench */
const HANG_KNEE = 60
/** braced (c = 1) and inhaled (c = 0) girdle and neck, deg */
const BREATH = { clavicle: [6.5, 4], neck: [0, -2] } as const
/** elbow joint height with the forearm on the mat, m (as the side plank) */
const ELBOW_Y = MAT_TOP + 0.054 - SINK
/** raised arm: share of the zero pose's shoulder-to-grip distance (elbow a little soft) */
const REACH_SOFT = 1.006
/** the bench pad's centre this far from the top ankle towards the knee, m (the pad lies under the lower shin) */
const PAD_FROM_ANKLE = 0.16
/** the bench's middle this far in front of the top ankle, m: its rear post and floor rail stay clear of the hanging
 * foot, which swings back under the pad */
const BENCH_AHEAD = 0.45

export type Copenhagen = {
  kind: 'copenhagen'
  tempo: Tempo
  setup: Setup
  /** forearm (bottom) side and the working top leg */
  sup: Side
  top: Side
  /** the braced body pose without the arms: root, spine and legs */
  body: Float64Array
  fist: { pos: V3; hand: Quat }
  reach: number
  mat: ImplementPose
  bench: ImplementPose
}

const other = (s: Side): Side => (s === 'l' ? 'r' : 'l')

function posture(skel: Skeleton, q: Float64Array, sup: Side, list: number, botAbd: number) {
  const s = sup === 'r' ? 1 : -1
  setDofs(skel, q, {
    'lumbar.flex': 2, 'thorax.flex': 0, 'head.flex': 0, 'clavicle_*.elev': 2, 'clavicle_*.prot': BREATH.clavicle[0],
    'hip_*.flex': 2, 'knee_*.flex': 2, 'ankle_*.df': 4, 'grip_*.close': 1,
    [`hip_${other(sup)}.abd`]: 0, [`hip_${sup}.abd`]: botAbd, [`knee_${sup}.flex`]: HANG_KNEE,
  })
  q[skel.dof['pelvis.list']] = s * list
}

/** loose fist on its little-finger edge, fingers along +Z, thumb up (core/plank.ts fistHand) */
const FIST: Quat = qfromBasis([1, 0, 0], [0, 0, -1])

export function copenhagenContext(p: P, skel: Skeleton, tempo: Tempo): Copenhagen {
  // the working side is the top leg; the body rests on the other forearm
  const top: Side = p.side === 'left' ? 'l' : 'r'
  const sup = other(top)
  const q = zeroQ(skel)
  const shoulderY = ELBOW_Y + skel.segments[skel.seg.humerus_l].length
  const shin = (c: { name: string }) => c.name.startsWith(`shank_${top}2`)
  const res = (x: number[]) => {
    posture(skel, q, sup, x[1], x[2])
    q[skel.dof['pelvis.ty']] = x[0]
    q[skel.dof['pelvis.tx']] = 0
    q[skel.dof['pelvis.tz']] = 0
    const sh = segPosOf(skel, fk(skel, q), `humerus_${sup}`)
    q[skel.dof['pelvis.tx']] = -sh[0]
    q[skel.dof['pelvis.tz']] = -sh[2]
    const caps = bodyCapsules(skel, fk(skel, q))
    const low = (pick: (c: { name: string; region: string }) => boolean) => Math.min(...caps.filter(pick).map((c) => Math.min(c.a[1], c.b[1]) - c.r))
    return [
      (segPosOf(skel, fk(skel, q), `humerus_${sup}`)[1] - shoulderY) * 10,
      (low(shin) - BENCH_TOP + SINK) * 10,
      (low((c) => c.region === `foot_${sup}`) - HANG) * 10,
    ]
  }
  const r = dls(res, [0.35, 85, 25], { tol: 1e-10, iters: 120 })
  res(r.x)
  const body = q.slice()
  const f = fk(skel, q)
  const sh = segPosOf(skel, f, `humerus_${sup}`)
  const lf = skel.segments[skel.seg.forearm_l].length
  const wrist: V3 = [sh[0], ELBOW_Y - 0.004, sh[2] + lf]
  const fist = { pos: add(wrist, qrot(FIST, skel.data.sites[`grip_${sup}`].local)), hand: FIST }
  const z0 = fk(skel, zeroQ(skel))
  const reach = REACH_SOFT * dist(segPosOf(skel, z0, `humerus_${top}`), toWorld(skel, z0, `hand_${top}`, skel.data.sites[`grip_${top}`].local))
  // the bench across the top shin: its pad (along Z) under the lower shin, its middle under the leg
  const ankle = segPosOf(skel, f, `foot_${top}`)
  const knee = segPosOf(skel, f, `tibia_${top}`)
  const toward = Math.sign(knee[0] - ankle[0])
  const benchSpec = flatBench({ id: 'bench', seatHeight: BENCH_TOP })
  const bench: ImplementPose = { id: benchSpec.id, pos: [ankle[0] + toward * PAD_FROM_ANKLE, BENCH_TOP, ankle[2] + BENCH_AHEAD], rot: qid() }
  // the mat under the forearm and the hips, ending before the bench
  const matSpec = floorMat({ length: 1.2 })
  const mat: ImplementPose = { id: matSpec.id, pos: [sh[0] - toward * 0.45, 0, 0.12], rot: qaxis([0, 1, 0], Math.PI / 2) }
  const fists: ImplementSpec = palmRest({ id: 'fists', sites: { [sup]: fist.pos } })
  const up: ImplementSpec = palmRest({ id: 'reach', sites: { [top]: [0, 0, 0] } })
  const contacts: Contact[] = [
    { site: `grip_${sup}`, kind: 'grip', target: { implement: fists.id, grip: sup } },
    { site: `grip_${top}`, kind: 'grip', target: { implement: up.id, grip: top } },
  ]
  const setup: Setup = {
    implements: [matSpec, benchSpec, fists, up],
    contacts,
    tempo,
    symmetric: false,
    // the inside of the top shin and ankle rests on the bench pad
    rests: [{ implement: benchSpec.id, regions: [`shank_${top}`, `foot_${top}`], tol: 15 }],
  }
  return { kind: 'copenhagen', tempo, setup, sup, top, body, fist, reach, mat, bench }
}

export function sampleCopenhagen(skel: Skeleton, v: Copenhagen, c: number): Pose {
  const q = v.body.slice()
  setDofs(skel, q, { 'clavicle_*.prot': lerp(BREATH.clavicle[1], BREATH.clavicle[0], c), 'neck.flex': lerp(BREATH.neck[1], BREATH.neck[0], c) })
  const s = v.sup === 'r' ? 1 : -1
  attachHand(skel, q, v.sup, { pos: v.fist.pos, axis: [0, 0, 1], palm: [s, 0, 0], hand: v.fist.hand }, { pole: [0, -1, -0.2], planeHint: 90 })
  // free arm straight up from the top shoulder, palm forward, elbow soft
  const pos = add(segPosOf(skel, fk(skel, q), `humerus_${v.top}`), [0, v.reach, 0])
  const x: V3 = v.top === 'l' ? [0, 0, -1] : [0, 0, 1]
  const hand = qfromBasis(x, [0, -1, 0])
  attachHand(skel, q, v.top, { pos, axis: qrot(hand, [0, 0, 1]), palm: [0, 0, 1], hand }, { pole: [0, 0, -1], planeHint: 90 })
  return { q, implements: [v.mat, v.bench, { id: 'fists', pos: [0, 0, 0], rot: qid() }, { id: 'reach', pos, rot: qid() }], contacts: v.setup.contacts }
}

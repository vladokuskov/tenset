import { root1d } from '../../constraints.ts'
import { bodyCapsules } from '../../collide.ts'
import { fk } from '../../fk.ts'
import { barbell, siteWorld, type ImplementSpec } from '../../implements.ts'
import { sealBench, SEAL_BENCH } from '../../implements/index.ts'
import { add, lerp3, qid, type Quat, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { BOTTOM_ELBOW } from './bent.ts'
import { ARM_DOFS, elbowPole, gripContacts, gripPath, lerp, mirrorArm, phases, PROT, reach, scapularLead, shoulderMid, type P } from './common.ts'
import { handSchedule } from './hand.ts'

// Seal row (319): lying face down along a raised flat bench (SEAL_BENCH, 0.82 m), the chin just past its head end, the
// legs straight along it and off its foot end, all still. The bar hangs at arm's length under the shoulders (scapulae
// protracted, elbows ~8 deg); the scapulae set back and the elbows drive the bar up until it touches the bench's
// underside below the chest. With the trunk supported there is no hinge to hold, only the pull.

/** 10 kg plates keep the hanging bar's plates well off the floor */
const PLATE_KG = 10
/** pad sink of the trunk and thighs, m */
const SINK = 0.01
/** the shoulder joints this far back from the bench's head end, m (chin just past it) */
const SHOULDERS_IN = 0.12
/** the bar touches the underside this far back from the shoulders, m (below the lower chest) */
const TOUCH_BACK = 0.1
/** the bar stops this far under the pad's underside, m: the drawn frame rails sit a little below the board */
const UNDER_GAP = 0.02

export type Seal = {
  kind: 'seal'
  tempo: Tempo
  setup: Setup
  base: Float64Array
  bar: ImplementSpec
  bench: ImplementPose
  /** bar centre at the hang (relative to the shoulder midpoint at s = 0) and at the top (world) */
  hang: V3
  top: V3
  sm0: V3
  /** the left hand's orientation by contraction (smooth) */
  hand?: (c: number) => Quat
}

function lie(skel: Skeleton, q: Float64Array, s: number) {
  setDofs(skel, q, {
    'lumbar.flex': 0,
    'thorax.flex': 2,
    // looking ahead and a little down past the bench's end
    'neck.flex': -22,
    'head.flex': -10,
    'hip_*.flex': 0,
    'knee_*.flex': 4,
    'ankle_*.df': -40,
    'clavicle_*.prot': lerp(PROT.start, PROT.finish, s),
    'clavicle_*.elev': lerp(2, -4, s),
    'grip_*.close': 1,
  })
}

function arms(skel: Skeleton, q: Float64Array, p: P, bar: ImplementSpec, pose: ImplementPose, hand?: Quat) {
  for (const k of ARM_DOFS) for (const sd of ['l', 'r']) q[skel.dof[k.replace('*', sd)]] = 0
  const g = siteWorld(bar, pose, 'l')
  // overhand, palms towards the feet
  reach(skel, q, 'l', { pos: g.pos, axis: [1, 0, 0], palm: [0, 0, -1], ...(hand ? { hand } : {}) }, { pole: elbowPole(skel, q, 'l', p.elbowFlare, 0.6), planeHint: 90, devBand: [-22, 25] })
  mirrorArm(skel, q)
}

function frame(skel: Skeleton, p: P, v: Pick<Seal, 'base' | 'bar' | 'hang' | 'top' | 'sm0' | 'hand'>, s: number, e: number, c?: number) {
  const q = Float64Array.from(v.base)
  lie(skel, q, s)
  const hang = add(v.hang, shoulderMid(skel, q))
  const pose: ImplementPose = { id: v.bar.id, pos: lerp3(hang, v.top, e), rot: qid() }
  arms(skel, q, p, v.bar, pose, c === undefined ? undefined : v.hand?.(c))
  return { q, pose }
}

export function sealContext(p: P, skel: Skeleton, tempo: Tempo): Seal {
  const spec = sealBench()
  const h = SEAL_BENCH.height.default
  const bench: ImplementPose = { id: spec.id, pos: [0, 0, 0], rot: qid() }
  const bar = barbell({ gripWidth: p.gripWidth * skel.data.shoulderWidth, plateKg: PLATE_KG })
  // face down, head towards +Z: pelvis tilted 90 forward, trunk and thighs resting on the pad
  const place = (y: number, z: number) => {
    const q = zeroQ(skel)
    lie(skel, q, 0)
    setPelvis(skel, q, [0, y, z], 90)
    return q
  }
  let y = h + 0.1, z = 0
  for (let pass = 0; pass < 4; pass++) {
    const q = place(y, z)
    const caps = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'trunk' || c.region.startsWith('thigh_'))
    const low = Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r))
    y += h - SINK - low
    z += SEAL_BENCH.len / 2 - SHOULDERS_IN - shoulderMid(skel, place(y, z))[2]
  }
  const base = place(y, z)
  const sm0 = shoulderMid(skel, base)
  const v: Seal = { kind: 'seal', tempo, setup: undefined as never, base, bar, bench, hang: [0, -0.6, 0], top: [0, 0, 0], sm0 }
  // top: the bar against the underside, below the lower chest
  const under = spec.sites.under.pos[1]
  v.top = [0, under - 0.014 - UNDER_GAP, sm0[2] - TOUCH_BACK]
  // hang: under the shoulders, the elbows just short of straight
  const elbowAt = (d: number) => {
    v.hang = [0, -d, 0]
    return frame(skel, p, v, 0, 0).q[skel.dof['elbow_l.flex']]
  }
  v.hang = [0, -root1d((d) => elbowAt(d) - BOTTOM_ELBOW, 0.4, 0.75, { tol: 1e-6 }).x, 0]
  v.hand = handSchedule(skel, (c) => {
    const ph = { s: scapularLead(c), g: gripPath(c) }
    return frame(skel, p, v, ph.s, ph.g).q
  })
  const contacts = gripContacts(bar.id)
  v.setup = { implements: [bar, spec], contacts, tempo, symmetric: true, rests: [{ implement: spec.id, regions: ['trunk', 'thigh_l', 'thigh_r'], tol: SINK * 1000 + 4 }] }
  return v
}

export function sampleSeal(u: number, p: P, skel: Skeleton, v: Seal): Pose {
  const ph = phases(u, v.tempo)
  const { q, pose } = frame(skel, p, v, ph.s, ph.g, ph.c)
  return { q, implements: [pose, v.bench], contacts: v.setup.contacts }
}

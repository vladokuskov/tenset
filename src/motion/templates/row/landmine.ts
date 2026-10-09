import { root1d } from '../../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { centerOfMass, fk } from '../../fk.ts'
import { comWorld, siteWorld, type ImplementSpec } from '../../implements.ts'
import { landmine, landmineBar, landminePitchFor, landminePose } from '../../implements/index.ts'
import { lerp, type V3 } from '../../math.ts'
import { zeroQ, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { makeStance, plantedContacts, stand, stanceWidth, standBalanced, type StanceSetup } from '../standing.ts'
import type { Setup } from '../types.ts'
import { trunk, trunkAngle } from './bent.ts'
import { ARM_DOFS, elbowPole, gripContacts, gripPath, mirrorArm, phases, reach, scapularLead, shoulderMid, type P } from './common.ts'

// T-bar row (316) on a landmine: the bar pivots in a floor landmine behind the lifter and runs forward between the legs,
// a close-grip V-handle hooked under it by the plates. Straddling the bar, hips hinged to torsoAngle (45) with soft
// knees, both held; the bar hangs with the handle under the shoulders (elbows ~8 deg), then the scapulae set back and the
// elbows drive close to the sides until the plates come up to the chest (elbow ~0 -> ~100-110 deg, as the bent row).
// The handle travels on the bar's arc about the pivot, a near-vertical line drifting a little back as it rises.

const KNEE = 22
/** 10 kg plates: a 20 kg plate's radius reaches the chest well before the elbows finish */
const PLATE_KG = 10
/** the plates or handle stop this far off the trunk and head at the top, m */
const TOP_GAP = 0.01
const BALANCE_TOL = 0.025
/**
 * elbow at the hang, deg: a little softer than the bent row's, so the handle's arc has slack while the scapulae set back
 * first (at the bent row's 8 the elbow snaps straight and back as the pull starts)
 */
const HANG_ELBOW = 11
/**
 * the handle hangs this far ahead of the shoulders, m: its arc about the pivot behind runs up and back, so starting a
 * little forward brings it to the lower chest instead of into the stomach
 */
const HANG_AHEAD = 0.28

export type Landmine = {
  kind: 'landmine'
  tempo: Tempo
  setup: Setup
  stance: StanceSetup
  tilt: number
  bar: ImplementSpec
  base: ImplementPose
  pivot: V3
  /** bar pitch at the hang and at the top, deg */
  pitch: [number, number]
  /** bar pitch by contraction, deg */
  pitchAt: (c: number) => number
}

function arms(skel: Skeleton, q: Float64Array, p: P, bar: ImplementSpec, pose: ImplementPose) {
  for (const k of ARM_DOFS) for (const s of ['l', 'r']) q[skel.dof[k.replace('*', s)]] = 0
  const g = siteWorld(bar, pose, 'v_l')
  // neutral close grip: palms in, the handle along the bar; elbows tucked to the sides. The wrist's deviation band is the
  // chest-supported T-bar's (338): ulnar deviation passes ~21 as the bar steepens near the top
  reach(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: [-1, 0, 0] }, { pole: elbowPole(skel, q, 'l', p.elbowFlare, 0.6), planeHint: 90, devBand: [-34, 25] })
  mirrorArm(skel, q)
}

function frame(skel: Skeleton, q: Float64Array, p: P, v: Pick<Landmine, 'stance' | 'tilt' | 'bar' | 'pivot'>, s: number, pitch: number) {
  trunk(skel, q, s)
  const pose = landminePose(v.bar.id, v.pivot, 0, pitch)
  const load = [{ mass: v.bar.mass, pos: comWorld(v.bar, pose) }]
  const bal = standBalanced(skel, q, v.stance, { knee: KNEE, tilt: v.tilt }, (qq) => centerOfMass(skel, fk(skel, qq), load)[2], (qq) => arms(skel, qq, p, v.bar, pose), [-15, 30])
  return { pose, bal }
}

export function landmineContext(p: P, skel: Skeleton, tempo: Tempo): Landmine {
  const stance = makeStance(skel, stanceWidth(skel, p.stance === 'wide' ? 'wide' : p.stance === 'shoulder' ? 'shoulder' : 'hip'), 12)
  const bar = landmineBar({ plateKg: PLATE_KG, handle: 'v' })
  const unit = landmine()
  const base = (s: number, tilt: number) => {
    const q = zeroQ(skel)
    trunk(skel, q, s)
    stand(skel, q, stance, { knee: KNEE, df: 12, tilt })
    return q
  }
  const tilt = root1d((t) => trunkAngle(skel, base(0.5, t)) - p.torsoAngle, 0, 85, { tol: 1e-5 }).x
  const v: Landmine = { kind: 'landmine', tempo, setup: undefined as never, stance, tilt, bar, base: { id: unit.id, pos: [0, 0, 0], rot: [0, 0, 0, 1] }, pivot: [0, unit.sites.pivot.pos[1], -1.5], pitch: [10, 30], pitchAt: () => 0 }
  const elbowAt = (pitch: number) => {
    const q = zeroQ(skel)
    frame(skel, q, p, v, 0, pitch)
    return { q, elbow: q[skel.dof['elbow_l.flex']] }
  }
  // hang: the handle just ahead of the shoulders with the elbows just short of straight; the pivot sits where that puts it
  for (let pass = 0; pass < 6; pass++) {
    v.pitch[0] = root1d((a) => elbowAt(a).elbow - HANG_ELBOW, -5, 40, { tol: 1e-6 }).x
    const { q } = elbowAt(v.pitch[0])
    const handle = siteWorld(bar, landminePose(bar.id, v.pivot, 0, v.pitch[0]), 'v_l').pos
    v.pivot = [0, v.pivot[1], v.pivot[2] + shoulderMid(skel, q)[2] + HANG_AHEAD - handle[2]]
  }
  v.pitch[0] = root1d((a) => elbowAt(a).elbow - HANG_ELBOW, -5, 40, { tol: 1e-6 }).x
  // top: the plates or the handle come up to the chest
  const gap = (pitch: number) => {
    const q = zeroQ(skel)
    const { pose } = frame(skel, q, p, v, 1, pitch)
    const body = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'trunk' || c.region === 'head' || c.region === 'neck')
    let m = Infinity
    for (const sd of placeParts(bar, pose)) for (const c of body) m = Math.min(m, capsuleSolidClearance(c, sd))
    return m - TOP_GAP
  }
  v.pitch[1] = root1d(gap, v.pitch[0] + 2, 60, { tol: 1e-5 }).x
  v.base = { id: unit.id, pos: [0, 0, v.pivot[2]], rot: [0, 0, 0, 1] }
  // the bar's pitch along the pull: the handle rises from the hang, which follows the shoulders as the scapulae set back
  // first (the plates lift a little with them), to the top along the lagging grip path
  const handleY = (pitch: number) => siteWorld(bar, landminePose(bar.id, v.pivot, 0, pitch), 'v_l').pos[1]
  const shY = (sc: number) => shoulderMid(skel, base(sc, v.tilt))[1]
  const [y0, y1, sh0] = [handleY(v.pitch[0]), handleY(v.pitch[1]), shY(0)]
  v.pitchAt = (c: number) => landminePitchFor(bar, 'v_l', v.pivot, 0, lerp(y0 + shY(scapularLead(c)) - sh0, y1, gripPath(c))) ?? v.pitch[1]
  const contacts = [...plantedContacts(skel, stance), ...gripContacts(bar.id, ['v_l', 'v_r'])]
  v.setup = { implements: [bar, unit], contacts, tempo, symmetric: true, balance: { point: 'com', over: 'midfoot', tol: BALANCE_TOL } }
  return v
}

export function sampleLandmine(u: number, p: P, skel: Skeleton, v: Landmine): Pose {
  const ph = phases(u, v.tempo)
  const q = zeroQ(skel)
  const { pose } = frame(skel, q, p, v, ph.s, v.pitchAt(ph.c))
  return { q, implements: [pose, v.base], contacts: v.setup.contacts }
}

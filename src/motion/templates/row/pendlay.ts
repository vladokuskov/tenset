import { root1d } from '../../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { centerOfMass, fk, localToWorld, segPos } from '../../fk.ts'
import { barbell, PLATE_20_RADIUS, type ImplementSpec } from '../../implements.ts'
import { add, lerp3, qrot, sub, type V3 } from '../../math.ts'
import { zeroQ, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { makeStance, plantedContacts, stand, stanceWidth, standBalanced, type StanceSetup } from '../standing.ts'
import type { Setup } from '../types.ts'
import { BOTTOM_ELBOW, PLATE_KG, RIB_GAP, trunk, trunkAngle } from './bent.ts'
import { ARM_DOFS, elbowPole, gripContacts, mirrorArm, phases, reach, scapularLead, type P } from './common.ts'

// Pendlay row (318): the bent row with the trunk near horizontal (torsoAngle ~80) and the bar returned to the floor
// every rep. The bar rests on its plates over the midfoot (with 20 kg plates its axis sits PLATE_20_RADIUS up) through
// the bottom pause, the hands still on it with the arms straight; the scapulae set back and the elbows drive it in a
// near-vertical line to the lower chest, then it is lowered back to the floor. Hips and trunk hold still (cue: hips at
// one height); the knees bend as far as lets straight arms reach the bar on the floor. Body and bar balance over the
// midfoot throughout (the bar sits over the midfoot on the floor, so whether its weight counts there barely moves it).

/** the bar over the front of the midfoot, this far ahead of the midfoot line: clear of the knees as it rises, m */
const BAR_AHEAD = 0.07
const BALANCE_TOL = 0.025
/** the bar passes this far in front of the knees, m */
const KNEE_CLEAR = 0.008
/** lower chest the bar rows to (segment-local, m): higher on the trunk than the 45 deg row's stomach (cue) */
const CHEST_SEG = 'thorax2'
const CHEST_LOCAL: V3 = [0, -0.07, 0]

export type Pendlay = {
  kind: 'pendlay'
  tempo: Tempo
  setup: Setup
  stance: StanceSetup
  bar: ImplementSpec
  tilt: number
  knee: number
  /** bar centre on the floor (world) and at the finish (relative to the pelvis) */
  floor: V3
  top: V3
  /** the bar's path bows forward by this much at its middle to pass in front of the knees, m */
  bow: number
}

const pelvisPos = (skel: Skeleton, q: Float64Array): V3 => segPos(skel, fk(skel, q), 'pelvis')

function barAt(skel: Skeleton, q: Float64Array, v: Pick<Pendlay, 'bar' | 'floor' | 'top' | 'bow'>, e: number): ImplementPose {
  const pos = lerp3(v.floor, add(pelvisPos(skel, q), v.top), e)
  pos[2] += v.bow * Math.sin(Math.PI * e)
  return { id: v.bar.id, pos, rot: [0, 0, 0, 1] }
}

function frame(skel: Skeleton, q: Float64Array, p: P, v: Pick<Pendlay, 'bar' | 'floor' | 'top' | 'bow' | 'stance' | 'tilt' | 'knee'>, s: number, e: number) {
  trunk(skel, q, s)
  let pose!: ImplementPose
  const measure = (qq: Float64Array) => centerOfMass(skel, fk(skel, qq), [{ mass: v.bar.mass, pos: barAt(skel, qq, v, e).pos }])[2]
  const bal = standBalanced(skel, q, v.stance, { knee: v.knee, tilt: v.tilt }, measure, (qq) => {
    pose = barAt(skel, qq, v, e)
    // the arm solve starts from the same state on every call, so balance iterations do not leave it a different hand roll
    for (const k of ARM_DOFS) for (const sd of ['l', 'r']) qq[skel.dof[k.replace('*', sd)]] = 0
    const g = add(pose.pos, v.bar.sites.l.pos)
    // overhand, palms back towards the feet; the deviation band past the ~15 deg this grip reaches, so the solve
    // never steps between two hand rolls as the bar nears the floor
    reach(skel, qq, 'l', { pos: g, axis: [1, 0, 0], palm: [0, 0, -1] }, { pole: elbowPole(skel, qq, 'l', p.elbowFlare, 0.6), planeHint: 90, devBand: [-22, 25] })
    mirrorArm(skel, qq)
  }, [-15, 30])
  return { pose, bal }
}

export function pendlayContext(p: P, skel: Skeleton, tempo: Tempo): Pendlay {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 10)
  const bar = barbell({ gripWidth: p.gripWidth * skel.data.shoulderWidth, plateKg: PLATE_KG })
  const base = (s: number, tilt: number, knee: number, df = 12) => {
    const q = zeroQ(skel)
    trunk(skel, q, s)
    stand(skel, q, stance, { knee, df, tilt })
    return q
  }
  const tilt = root1d((t) => trunkAngle(skel, base(0.5, t, 30)) - p.torsoAngle, 0, 89, { tol: 1e-5 }).x
  const v: Pendlay = { kind: 'pendlay', tempo, setup: undefined as never, stance, bar, tilt, knee: 30, floor: [0, PLATE_20_RADIUS, stance.midfoot[2] + BAR_AHEAD], top: [0, 0, 0], bow: 0 }
  // finish: the bar against the lower chest, reached along the trunk's front normal (as the bent row)
  const top = (knee: number) => {
    const q1 = base(1, tilt, knee)
    const pel1 = pelvisPos(skel, q1)
    const f1 = fk(skel, q1)
    const rib = localToWorld(skel, f1, CHEST_SEG, CHEST_LOCAL)
    const front = qrot(f1.rot[skel.seg[CHEST_SEG]], [0, 0, 1])
    const trunkCaps = bodyCapsules(skel, f1).filter((c) => c.region === 'trunk')
    const at = (d: number): V3 => [0, rib[1] + front[1] * d, rib[2] + front[2] * d]
    const gap = (d: number) => Math.min(...trunkCaps.map((c) => capsuleSolidClearance(c, placeParts(bar, { id: bar.id, pos: at(d), rot: [0, 0, 0, 1] })[0]))) - RIB_GAP
    return sub(at(root1d(gap, 0, 0.4, { tol: 1e-6 }).x), pel1)
  }
  // knees: as bent as lets the straight arms (BOTTOM_ELBOW) reach the bar on the floor with the body balanced
  const elbowAt = (knee: number) => {
    v.knee = knee
    v.top = top(knee)
    const q = zeroQ(skel)
    frame(skel, q, p, v, 0, 0)
    return q[skel.dof['elbow_l.flex']]
  }
  v.knee = root1d((k) => elbowAt(k) - BOTTOM_ELBOW, 5, 75, { tol: 1e-5 }).x
  v.top = top(v.knee)
  // the path bows forward just enough for the bar to pass KNEE_CLEAR in front of the knees and thighs
  const thighGap = () => {
    let m = Infinity
    for (let k = 1; k < 16; k++) {
      const q = zeroQ(skel)
      const { pose } = frame(skel, q, p, v, scapularLead(k / 16), k / 16)
      const legs = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region.startsWith('thigh_') || c.region.startsWith('shank_'))
      const shaft = placeParts(bar, pose)[0]
      for (const c of legs) m = Math.min(m, capsuleSolidClearance(c, shaft))
    }
    return m - KNEE_CLEAR
  }
  while (thighGap() < 0 && v.bow < 0.1) v.bow += 0.005
  const contacts = [...plantedContacts(skel, stance), ...gripContacts(bar.id)]
  v.setup = { implements: [bar], contacts, tempo, symmetric: true, balance: { point: 'com', over: 'midfoot', tol: BALANCE_TOL } }
  return v
}

export function samplePendlay(u: number, p: P, skel: Skeleton, v: Pendlay): Pose {
  const ph = phases(u, v.tempo)
  const q = zeroQ(skel)
  // the scapulae set back as the bar leaves the floor, not before (it cannot follow the shoulders up)
  const { pose } = frame(skel, q, p, v, scapularLead(ph.g), ph.g)
  return { q, implements: [pose], contacts: v.setup.contacts }
}

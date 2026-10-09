import { attachHand, root1d } from '../../constraints.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { fk, segPos } from '../../fk.ts'
import { cableHandle, type Cable, type ImplementSpec, type Part } from '../../implements.ts'
import { add, lerp, norm, qfromBasis, qrot, sub, type Quat, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import { handSchedule } from '../row/hand.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { pressureZ } from '../isolation.ts'
import { monotoneCubic } from '../solve.ts'
import type { ParamsOf } from '../schemas.ts'
import { limitSway, makeStance, plantedContacts, stand, stanceWidth, standBalanced, type StanceSetup, type Sway } from '../standing.ts'
import type { Setup } from '../types.ts'

// Cable upright row (227, movement upright_row): standing tall facing a low pulley, a straight bar overhand at about
// shoulder width. The bar starts in front of the thighs with the arms long and rises close up the body, the elbows
// leading out and up, until the elbows reach shoulder height (shoulder abduction ~85 deg, elbows ~100-120 deg;
// research: upright row abduction to ~80-90, the humerus internally rotated, the traps elevating the girdle in the
// top third). The clavicles lift as the arms rise (upper traps), the trunk stays still; the ankles keep body, bar and
// the cable's pull over the midfoot.

type P = ParamsOf<'shrug'>

const KNEE = 6
/** low pulley: height and how far ahead of the midfoot, m; stack load, kg (the cable shrug's) */
const CABLE = { pulleyY: 0.08, ahead: 0.5, kg: 15 }
const BAR_Y = -0.05
/** the bar keeps this far off the thighs and trunk on its way up, m */
const BODY_GAP = 0.035
const HANG_ELBOW = 8
/** humerothoracic elevation at the top (elbows at shoulder height), deg */
const TOP_ELEV = 85
/** clavicle elevation and protraction at the hang and the top, deg (the upper traps lift the girdle late) */
const CLAV = { elev: [-2, 18], prot: [-2, 4] }
const BALANCE_TOL = 0.035
/** palm hint (world, y and z) at the hang and the top: the hemisphere the solver keeps the palm in */
const PALM = { hang: [0, 0, -1], top: [0, -1, 0.3] }

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

export type UprightRow = {
  kind: 'upright'
  tempo: Tempo
  setup: Setup
  stance: StanceSetup
  bar: ImplementSpec
  cable: Cable
  /** bar centre relative to the pelvis by bar-height fraction e */
  path: (e: number) => V3
  /** the left hand's orientation by contraction (smooth) */
  hand?: (c: number) => Quat
  sway?: Sway
}

function bar(gripWidth: number): ImplementSpec {
  const base = cableHandle({ id: 'handle', attachment: 'straight_bar' })
  const g = gripWidth / 2
  const w = Math.max(0.25, g + 0.07)
  return { ...base, parts: [cyl([0, 0, 0], [0, BAR_Y, 0], 0.01), cyl([-w, BAR_Y, 0], [w, BAR_Y, 0], 0.014)], sites: { l: { pos: [g, BAR_Y, 0], axis: [1, 0, 0] }, r: { pos: [-g, BAR_Y, 0], axis: [1, 0, 0] } } }
}

function barStack(pulley: V3): ImplementSpec {
  return { id: 'bar_stack', kind: 'bench', mass: 0, com: [0, 0, 0], parts: [cyl([0, 0, pulley[2] + 0.12], [0, 2.1, pulley[2] + 0.12], 0.05), cyl(pulley, [pulley[0], pulley[1], pulley[2] + 0.12], 0.04)], sites: {} }
}

function base(skel: Skeleton) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': -1, 'thorax.flex': 1, 'neck.flex': -3, 'head.flex': 0, 'grip_*.close': 1 })
  return q
}

const pelvis = (skel: Skeleton, q: Float64Array): V3 => segPos(skel, fk(skel, q), 'pelvis')

/** a cable bar hangs from its carabiner towards the pulley with the grips' midpoint on `center` */
function barPose(spec: ImplementSpec, center: V3, pulley: V3): ImplementPose {
  const rot = qfromBasis([1, 0, 0], norm(sub(pulley, center)))
  return { id: spec.id, pos: sub(center, qrot(rot, [0, BAR_Y, 0])), rot }
}

function arms(skel: Skeleton, q: Float64Array, v: Pick<UprightRow, 'bar' | 'cable' | 'hand'>, c: number, center: V3) {
  setDofs(skel, q, { 'clavicle_*.elev': lerp(CLAV.elev[0], CLAV.elev[1], c * c), 'clavicle_*.prot': lerp(CLAV.prot[0], CLAV.prot[1], c) })
  const pose = barPose(v.bar, center, v.cable.pulley)
  const g = add(pose.pos, qrot(pose.rot, v.bar.sites.l.pos))
  // overhand, palms towards the body, turning down over the bar as the elbows lead out and up: the palm hint follows
  // c so the hand's roll search stays on one forearm rotation branch through the whole rep
  const hand = v.hand?.(c)
  attachHand(skel, q, 'l', { pos: g, axis: [1, 0, 0], palm: norm([0, lerp(PALM.hang[1], PALM.top[1], c), lerp(PALM.hang[2], PALM.top[2], c)]), ...(hand ? { hand } : {}) }, { pole: norm([1, lerp(-0.2, 0.9, c), -0.3]), planeHint: 10, devBand: [-30, 25] })
  for (const k of ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']) {
    q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
  }
  return pose
}

function frame(skel: Skeleton, v: UprightRow, c: number, sway = v.sway) {
  const q = base(skel)
  let pose!: ImplementPose
  const measure = (qq: Float64Array) => {
    const center = add(pelvis(skel, qq), v.path(c))
    const p = barPose(v.bar, center, v.cable.pulley)
    return pressureZ(skel, qq, [{ mass: v.bar.mass, pos: add(p.pos, qrot(p.rot, v.bar.com)) }], [{ cable: v.cable, pose: p }])
  }
  const bal = standBalanced(skel, q, v.stance, { knee: KNEE, tilt: 2 }, measure, (qq) => (pose = arms(skel, qq, v, c, add(pelvis(skel, qq), v.path(c)))), undefined, sway)
  return { q, pose, bal }
}

export function uprightContext(p: P, skel: Skeleton, tempo: Tempo): UprightRow {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const spec = bar(p.gripWidth * skel.data.shoulderWidth)
  const cable: Cable = { pulley: [0, CABLE.pulleyY, stance.midfoot[2] + CABLE.ahead], implement: spec.id, point: [0, 0, 0], kg: CABLE.kg }
  const v: UprightRow = { kind: 'upright', tempo, setup: undefined as never, stance, bar: spec, cable, path: () => [0, 0, 0.2] }
  const q0 = base(skel)
  stand(skel, q0, stance, { knee: KNEE, df: 6, tilt: 2 })
  const pel0 = pelvis(skel, q0)
  const body = bodyCapsules(skel, fk(skel, q0)).filter((k) => k.region === 'trunk' || k.region.startsWith('thigh_'))
  /** the bar centre at height y, BODY_GAP in front of the thighs or trunk */
  const at = (y: number): V3 => {
    const gap = (z: number) => {
      const solids = placeParts(spec, barPose(spec, [0, y, z], cable.pulley))
      return Math.min(...solids.flatMap((sd) => body.map((k) => capsuleSolidClearance(k, sd)))) - BODY_GAP
    }
    return [0, y, root1d(gap, -0.1, 0.5, { tol: 1e-6 }).x]
  }
  const armAt = (c: number, y: number) => {
    const q = Float64Array.from(q0)
    arms(skel, q, v, c, at(y))
    return q
  }
  const yHang = root1d((y) => armAt(0, y)[skel.dof['elbow_l.flex']] - HANG_ELBOW, 0.5, 1.0, { tol: 1e-6 }).x
  const yTop = root1d((y) => armAt(1, y)[skel.dof['shoulder_l.elev']] - TOP_ELEV, yHang + 0.1, 1.6, { tol: 1e-6 }).x
  const es = Array.from({ length: 9 }, (_, k) => k / 8)
  const rel = es.map((e) => sub(at(lerp(yHang, yTop, e)), pel0))
  const [fy, fz] = [1, 2].map((i) => monotoneCubic(es, rel.map((r) => r[i])))
  v.path = (e) => [0, fy(e), fz(e)]
  // the hand's roll solved free at knots and smoothed: the wrist eases onto its deviation stop as the elbows pass ~90
  // instead of meeting it in one frame
  v.hand = handSchedule(skel, (c) => frame(skel, v, c).q, 9)
  const contacts: Contact[] = [...plantedContacts(skel, stance), { site: 'grip_l', kind: 'grip', target: { implement: spec.id, grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: spec.id, grip: 'r' } }]
  v.setup = {
    implements: [spec, barStack(cable.pulley)],
    contacts,
    tempo,
    symmetric: true,
    cables: [cable],
    balance: { point: 'com', over: 'midfoot', tol: BALANCE_TOL },
    rests: [{ implement: spec.id, regions: ['thigh_l', 'thigh_r', 'trunk'], tol: -(BODY_GAP * 1000 - 25) }],
  }
  v.sway = limitSway((u, sway) => frame(skel, v, phaseAt(u, tempo).c, sway).bal, BALANCE_TOL - 0.005)
  void capsuleClearance
  return v
}

export function sampleUpright(u: number, _p: P, skel: Skeleton, v: UprightRow): Pose {
  const { q, pose } = frame(skel, v, phaseAt(u, v.tempo).c)
  return { q, implements: [pose, { id: 'bar_stack', pos: [0, 0, 0], rot: [0, 0, 0, 1] }], contacts: v.setup.contacts }
}

import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { handFrame, root1d } from '../../constraints.ts'
import { centerOfMass, fk, sitePos } from '../../fk.ts'
import { barbell, type ImplementSpec } from '../../implements.ts'
import { add, dist, lerp, norm, qfromBasis, scale, sub } from '../../math.ts'
import { setDofs, setScapula, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import { ARM_BALANCE_TOL, limitSway, makeStance, plantedContacts, stanceWidth, standBalanced, type StanceSetup, type Sway } from '../standing.ts'
import { armDir, swing } from '../triceps/common.ts'
import type { Setup } from '../types.ts'

// Behind-the-back barbell wrist curl (749): standing, the bar held behind the thighs with straight arms, palms facing
// back. Only the wrists move: from extension (the bar rolls down towards the fingers, against the back of the
// thighs) to flexion, curling the bar up and back. The arms hang a little behind the trunk, just far enough that the
// bar clears the buttocks and hamstrings at the stretch. Wrist range from the joint limits less a margin, as the
// kneeling wrist curls.

type P = ParamsOf<'wrist-curl'>

const BEHIND = {
  plateKg: 5,
  knee: 6,
  tilt: 2,
  /** upper arms out from the side, deg; elbows all but straight */
  abd: 8,
  elbow: 4,
  /** palms back */
  pro: 80,
  /** wrist flexion (deg, + towards the palm) at the stretch and at the top */
  range: [-40, 55] as [number, number],
  /** the bar keeps this far off the back of the thighs and buttocks over the rep, m */
  clear: 0.012,
}

export type Behind = {
  tempo: Tempo
  setup: Setup
  stance: StanceSetup
  bar: ImplementSpec
  /** shoulder extension (deg) and the grip's half spacing (m) */
  ext: number
  half: number
  sway?: Sway
}

function base(skel: Skeleton) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': -1, 'thorax.flex': 1, 'neck.flex': -3, 'clavicle_*.prot': -6, 'grip_*.close': 1 })
  return q
}

/** both arms hanging `ext` deg behind the trunk, wrists at `flex`; deviation keeps the hands on the bar's spacing */
function arms(skel: Skeleton, q: Float64Array, ext: number, flex: number, half?: number) {
  const { plane, elev } = swing(armDir(-ext, BEHIND.abd))
  setDofs(skel, q, { 'shoulder_*.plane': plane, 'shoulder_*.elev': elev, 'shoulder_*.rot': 0, 'elbow_*.flex': BEHIND.elbow, 'forearm_*.pro': BEHIND.pro, 'wrist_*.flex': flex, 'wrist_*.dev': 0 })
  setScapula(skel, q, 'l')
  setScapula(skel, q, 'r')
  if (half === undefined) return
  const dl = skel.dof['wrist_l.dev'], dr = skel.dof['wrist_r.dev']
  q[dl] = root1d((d) => {
    q[dl] = d
    return sitePos(skel, fk(skel, q), 'grip_l')[0] - half
  }, -30, 18, { tol: 1e-7 }).x
  q[dr] = q[dl]
}

function barPose(skel: Skeleton, q: Float64Array, bar: ImplementSpec): ImplementPose {
  const f = fk(skel, q)
  const gl = sitePos(skel, f, 'grip_l'), gr = sitePos(skel, f, 'grip_r')
  return { id: bar.id, pos: scale(add(gl, gr), 0.5), rot: qfromBasis(norm(sub(gl, gr)), norm(handFrame(skel, f, 'l').palm)) }
}

function frame(skel: Skeleton, q: Float64Array, v: Behind, c: number, sway?: Sway) {
  const flex = lerp(BEHIND.range[0], BEHIND.range[1], c)
  const upper = (qq: Float64Array) => arms(skel, qq, v.ext, flex, v.half)
  const measure = (qq: Float64Array) => centerOfMass(skel, fk(skel, qq), [{ mass: v.bar.mass, pos: barPose(skel, qq, v.bar).pos }])[2]
  const bal = standBalanced(skel, q, v.stance, { knee: BEHIND.knee, tilt: BEHIND.tilt }, measure, upper, undefined, sway)
  return { bal, pose: barPose(skel, q, v.bar) }
}

export function behindContext(_p: P, skel: Skeleton, tempo: Tempo): Behind {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const v: Behind = { tempo, setup: undefined as unknown as Setup, stance, bar: barbell({ gripWidth: 0.5, plateKg: BEHIND.plateKg }), ext: 0, half: 0 }
  // grip spacing from the hanging arms, then the bar sized to it
  const q0 = base(skel)
  arms(skel, q0, 0, 0)
  const f0 = fk(skel, q0)
  v.half = sitePos(skel, f0, 'grip_l')[0]
  v.bar = barbell({ gripWidth: dist(sitePos(skel, f0, 'grip_l'), sitePos(skel, f0, 'grip_r')), plateKg: BEHIND.plateKg })
  const contacts = plantedContacts(skel, stance)
  contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: v.bar.id, grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: v.bar.id, grip: 'r' } })
  v.setup = { implements: [v.bar], contacts, tempo, symmetric: true, balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL } }
  // the arms swing back until the bar clears the back of the body at the stretch (wrists extended)
  const clear = (ext: number) => {
    v.ext = ext
    const q = base(skel)
    const { pose } = frame(skel, q, v, 0)
    const caps = bodyCapsules(skel, fk(skel, q)).filter((k) => k.region === 'trunk' || k.region.startsWith('thigh_'))
    return Math.min(...placeParts(v.bar, pose).flatMap((s) => caps.map((k) => capsuleSolidClearance(k, s)))) - BEHIND.clear
  }
  v.ext = clear(0) >= 0 ? 0 : root1d(clear, 0, 30, { tol: 1e-4 }).x
  v.sway = limitSway((u, sway) => frame(skel, base(skel), v, phaseAt(u, tempo).c, sway).bal)
  return v
}

export function sampleBehind(u: number, skel: Skeleton, v: Behind): Pose {
  const q = base(skel)
  const { pose } = frame(skel, q, v, phaseAt(u, v.tempo).c, v.sway)
  return { q, implements: [pose], contacts: v.setup.contacts }
}

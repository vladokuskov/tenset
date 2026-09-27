import { lerp } from '../math.ts'
import { setDofs, shoulderRhythm, zeroQ, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt } from '../timing.ts'
import { comWithDumbbells, dumbbellContacts, dumbbellPoses, handDumbbells, isWorking, sidePhase } from './arms.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { makeStance, plantedContacts, stanceWidth, standBalanced } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Standing dumbbell lateral raise, joint space: humerothoracic elevation in a fixed plane with a soft elbow,
// clavicle from the scapulohumeral rhythm, slight hip hinge; ankles balance the body + dumbbell COM over midfoot.

type P = ParamsOf<'lateral-raise'>

const DB_KG = 10
const BOTTOM_ELEV = 10

const context = memo((p: P, skel: Skeleton) => {
  if (p.implement !== 'dumbbell' || p.posture !== 'standing' || p.support !== 'none' || p.leanAngle !== 0) {
    throw new Error(`lateral-raise: variant not implemented yet (${p.implement}/${p.posture}/${p.support}/lean ${p.leanAngle})`)
  }
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const setup: Setup = {
    implements: handDumbbells(DB_KG),
    contacts: [...plantedContacts(skel, stance), ...dumbbellContacts()],
    tempo,
    symmetric: p.laterality === 'bilateral',
    balance: { point: 'com', over: 'midfoot', tol: 0.025 },
  }
  return { stance, tempo, setup, measure: comWithDumbbells(skel, DB_KG) }
})

function arm(skel: Skeleton, q: Float64Array, s: 'l' | 'r', c: number, p: P) {
  const elev = lerp(BOTTOM_ELEV, p.topElevation, c)
  const g = shoulderRhythm(elev, p.plane)
  const d = skel.dof
  q[d[`shoulder_${s}.plane`]] = p.plane
  q[d[`shoulder_${s}.elev`]] = elev
  q[d[`shoulder_${s}.rot`]] = 4 * c
  q[d[`elbow_${s}.flex`]] = p.elbowAngle
  q[d[`forearm_${s}.pro`]] = p.grip === 'pronated' ? 30 : 0
  q[d[`wrist_${s}.flex`]] = 0
  q[d[`clavicle_${s}.elev`]] = g.elev
  q[d[`clavicle_${s}.prot`]] = g.prot
  q[d[`grip_${s}.close`]] = 1
}

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': 2, 'thorax.flex': 3, 'neck.flex': -6, 'head.flex': -2 })
  const cs = (['l', 'r'] as const).map((s) => (isWorking(s, p.laterality, p.side) ? phaseAt(sidePhase(u, s, p.laterality), ctx.tempo).c : 0))
  const upper = (qq: Float64Array) => {
    arm(skel, qq, 'l', cs[0], p)
    arm(skel, qq, 'r', cs[1], p)
  }
  standBalanced(skel, q, ctx.stance, { knee: 8, tilt: 6 }, ctx.measure, upper)
  return { q, implements: dumbbellPoses(skel, q), contacts: ctx.setup.contacts }
}

export const lateralRaise: Template<P> = {
  id: 'lateral-raise',
  driver: 'joint',
  params: SCHEMAS['lateral-raise'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}

import { lerp } from '../math.ts'
import { setDofs, zeroQ, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, minJerk, phaseAt } from '../timing.ts'
import { comWithDumbbells, dumbbellContacts, dumbbellPoses, handDumbbells, isWorking, sidePhase } from './arms.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { makeStance, plantedContacts, stanceWidth, standBalanced } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Standing dumbbell curl, joint space. Elbow ~8 -> 140 deg, the elbow drifts slightly forward near the top,
// optional supination from neutral early in the concentric. Ankles balance body + dumbbells over midfoot.

type P = ParamsOf<'curl'>

const DB_KG = 12
const ELBOW: [number, number] = [8, 140]

const context = memo((p: P, skel: Skeleton) => {
  if (p.implement !== 'dumbbell' || p.posture !== 'standing' || p.shoulderFlexion !== undefined) {
    throw new Error(`curl: variant not implemented yet (${p.implement}/${p.posture})`)
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

function forearm(p: P, c: number) {
  if (p.supinate) return lerp(0, -80, minJerk(c / 0.8))
  return p.grip === 'supinated' ? -80 : p.grip === 'pronated' ? 80 : 0
}

/** c drives the elbow; cl (slightly lagged) the upper arm drift and forearm rotation */
function arm(skel: Skeleton, q: Float64Array, s: 'l' | 'r', c: number, cl: number, p: P) {
  const d = skel.dof
  q[d[`shoulder_${s}.plane`]] = 80
  q[d[`shoulder_${s}.elev`]] = 4 + 12 * cl * cl
  q[d[`shoulder_${s}.rot`]] = 0
  q[d[`elbow_${s}.flex`]] = lerp(ELBOW[0], ELBOW[1], c)
  q[d[`forearm_${s}.pro`]] = forearm(p, cl)
  q[d[`wrist_${s}.flex`]] = 6 * c
  q[d[`clavicle_${s}.prot`]] = -3
  q[d[`grip_${s}.close`]] = 1
}

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': -1, 'thorax.flex': 1, 'neck.flex': -3 })
  const upper = (qq: Float64Array) => {
    for (const s of ['l', 'r'] as const) {
      const us = sidePhase(u, s, p.laterality)
      const on = isWorking(s, p.laterality, p.side)
      arm(skel, qq, s, on ? phaseAt(us, ctx.tempo).c : 0, on ? phaseAt(us, ctx.tempo, 0.015).c : 0, p)
    }
  }
  standBalanced(skel, q, ctx.stance, { knee: 6, tilt: 2 }, ctx.measure, upper)
  return { q, implements: dumbbellPoses(skel, q), contacts: ctx.setup.contacts }
}

export const curl: Template<P> = {
  id: 'curl',
  driver: 'joint',
  params: SCHEMAS.curl,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}

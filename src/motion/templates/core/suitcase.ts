import { handFrame, implementFromHand, root1d } from '../../constraints.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { centerOfPressure, fk } from '../../fk.ts'
import { dumbbell, type ImplementSpec } from '../../implements.ts'
import { lerp } from '../../math.ts'
import { setDofs, shoulderRhythm, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import { makeStance, plantedContacts, standBalanced, stanceWidth, type StanceName, type StanceSetup } from '../standing.ts'
import type { Setup } from '../types.ts'

// Suitcase hold (824) as a breathing hold: standing tall with a heavy dumbbell in the working hand at the side, the
// arm long, shoulders level and the ribs stacked over the hips (no lean towards the load: the trunk resists lateral
// flexion). The free arm hangs relaxed. The ankles balance body + load over the midfoot; sideways the load moves the
// centre of pressure towards the working foot, still between the feet. The breath as the planks (core/plank.ts):
// the slow eccentric inhales, the quick concentric braces. Author judgment (research: anti-lateral-flexion holds keep
// a neutral spine).

type P = ParamsOf<'hold'>

/** dumbbell mass, kg ("heavy"); deg: the breath, inhaled -> braced, and the loaded shoulder held level */
export const SUITCASE = { kg: 24, lumbar: [0, -1], thorax: [2, 1], clavicle: [1, 2], loaded: -2, knee: 5, tilt: 2 } as const
/** clearance of the dumbbell and the hand from the thigh, m */
const OFF_THIGH = 0.015
const ELBOW = 5

export type Suitcase = {
  kind: 'suitcase'
  tempo: Tempo
  setup: Setup
  work: Side
  stance: StanceSetup
  db: ImplementSpec
  /** working arm abduction that clears the thigh, deg */
  abd: number
}

function trunk(skel: Skeleton, q: Float64Array, v: Pick<Suitcase, 'work'>, c: number) {
  const free: Side = v.work === 'l' ? 'r' : 'l'
  setDofs(skel, q, {
    'lumbar.flex': lerp(SUITCASE.lumbar[0], SUITCASE.lumbar[1], c),
    'thorax.flex': lerp(SUITCASE.thorax[0], SUITCASE.thorax[1], c),
    'neck.flex': -2,
    [`clavicle_${free}.elev`]: lerp(SUITCASE.clavicle[0], SUITCASE.clavicle[1], c),
    // the loaded shoulder pulled down a touch by the weight, held close to level
    [`clavicle_${v.work}.elev`]: SUITCASE.loaded,
    'clavicle_*.prot': 0,
  })
}

/** both arms hang in joint space: the working one a little out from the side so the dumbbell clears the thigh */
function arms(skel: Skeleton, q: Float64Array, v: Pick<Suitcase, 'work' | 'abd'>) {
  for (const s of ['l', 'r'] as const) {
    const work = s === v.work
    const elev = work ? v.abd : 6
    setDofs(skel, q, {
      [`shoulder_${s}.plane`]: work ? 0 : 20,
      [`shoulder_${s}.elev`]: elev,
      [`shoulder_${s}.rot`]: 0,
      [`elbow_${s}.flex`]: work ? ELBOW : 12,
      [`forearm_${s}.pro`]: work ? 0 : 20,
      [`wrist_${s}.flex`]: 0,
      [`wrist_${s}.dev`]: 0,
      [`scapula_${s}.uprot`]: shoulderRhythm(elev, 0).uprot,
      [`grip_${s}.close`]: work ? 1 : 0,
    })
  }
}

function dbPose(skel: Skeleton, q: Float64Array, v: Pick<Suitcase, 'work' | 'db'>): ImplementPose {
  const h = handFrame(skel, fk(skel, q), v.work)
  return { id: v.db.id, pos: h.pos, rot: implementFromHand(h.axis, h.palm) }
}

const measure = (skel: Skeleton, v: Pick<Suitcase, 'work' | 'db'>) => (q: Float64Array) => centerOfPressure(skel, fk(skel, q), [{ mass: v.db.mass, pos: dbPose(skel, q, v).pos }])[1]

function frame(skel: Skeleton, v: Omit<Suitcase, 'kind' | 'tempo' | 'setup'>, c: number): Float64Array {
  const q = zeroQ(skel)
  trunk(skel, q, v, c)
  standBalanced(skel, q, v.stance, { knee: SUITCASE.knee, tilt: SUITCASE.tilt }, measure(skel, v), (qq) => arms(skel, qq, v))
  return q
}

export function suitcaseContext(p: P, skel: Skeleton, tempo: Tempo): Suitcase {
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const stance = makeStance(skel, stanceWidth(skel, p.stance as StanceName), 6)
  const db = dumbbell({ id: `db_${work}`, mass: SUITCASE.kg })
  const v = { work, stance, db, abd: 8 }
  // the working arm's abduction that keeps the dumbbell and the hand just off the thigh
  const gap = (abd: number) => {
    v.abd = abd
    const q = frame(skel, v, 0)
    const caps = bodyCapsules(skel, fk(skel, q))
    const hands = caps.filter((k) => k.region === `hand_${work}`)
    const solids = placeParts(db, dbPose(skel, q, v))
    const gaps = caps.filter((k) => k.region === `thigh_${work}`).flatMap((t) => [...solids.map((sd) => capsuleSolidClearance(t, sd)), ...hands.map((h) => capsuleClearance(h, t))])
    return Math.min(...gaps) - OFF_THIGH
  }
  v.abd = root1d(gap, 0, 30, { tol: 1e-5, scan: 7 }).x
  const contacts: Contact[] = [...plantedContacts(skel, stance), { site: `grip_${work}`, kind: 'grip', target: { implement: db.id, grip: 'c' } }]
  const setup: Setup = { implements: [db], contacts, tempo, symmetric: false, balance: { point: 'com', over: 'midfoot', tol: 0.03 } }
  return { kind: 'suitcase', tempo, setup, ...v }
}

export function sampleSuitcase(skel: Skeleton, v: Suitcase, c: number): Pose {
  const q = frame(skel, v, c)
  return { q, implements: [dbPose(skel, q, v)], contacts: v.setup.contacts }
}

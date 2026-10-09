import { centerOfPressure, fk } from '../../fk.ts'
import { cableForce, type Cable } from '../../implements.ts'
import { add, lerp, norm, qconj, qid, qrot, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { makeStance, plantedContacts, standBalanced, stanceWidth, type StanceSetup } from '../standing.ts'
import { ROPE_IDS, ropeContacts, ropeImplements, ropePoses } from '../triceps/rope.ts'
import type { Setup } from '../types.ts'
import { stackSpec } from './cable.ts'
import { toWorld } from './floor.ts'
import { FIST, fists, ROPE_FREE, STRAND_IN } from './kneel-crunch.ts'

// Standing cable crunch (840): standing at hip width with the back to a high pulley, knees soft, the fists holding the
// rope beside the head as in the kneeling crunch (core/kneel-crunch.ts); the spine curls the ribs towards the pelvis
// while the hips and knees stay nearly put. Facing away, curling forwards and down draws the cable out of the pulley
// (facing it, the curl would move the hands towards the pulley and unload the stack). The cable pulls up and back, so
// the body leans a little forwards over the feet (the ankles balance body and cable pull over the midfoot). Research
// (motion-authoring): trunk flexion is thoracolumbar; standing, the curl stops a little short of the kneeling one
// (author judgment).

/**
 * deg, upright -> curled: the pelvis curls under (posterior tilt) and the knees soften a little more as the ribs come
 * down, which keeps the body balanced over the feet without a hip hinge; lumbar and thoracic flexion, neck and head
 */
export const STAND = { tilt: [4, -6], knee: [14, 24], lumbar: [-2, 24], thorax: [0, 28], neck: [4, 12], head: [2, 4] } as const
/** the pulley sits high on the column, this far behind the upright head (m) */
const PULLEY_Y = 2.2
const PULLEY_BEHIND = 0.35
/** fists a centimetre further out beside the temples than kneeling, so the strands clear the head (head frame, m) */
const STAND_FIST: V3 = [FIST[0] + 0.012, FIST[1], FIST[2]]
/** stack load for the cable force, kg */
const CABLE_KG = 10
/** the free strands leave the fists this far past the grip centre, m: further than kneeling, where the flatter cable at the top bends them forwards over the thumbs */
const EXIT = 0.145

export type StandCrunch = {
  kind: 'stand'
  tempo: Tempo
  setup: Setup
  stance: StanceSetup
  pulley: V3
  cable: Cable
  /** rope direction out of the left fist, head frame */
  strand: V3
}

function body(skel: Skeleton, q: Float64Array, c: number) {
  setDofs(skel, q, {
    'lumbar.flex': lerp(STAND.lumbar[0], STAND.lumbar[1], c),
    'thorax.flex': lerp(STAND.thorax[0], STAND.thorax[1], c),
    'neck.flex': lerp(STAND.neck[0], STAND.neck[1], c),
    'head.flex': lerp(STAND.head[0], STAND.head[1], c),
    'clavicle_*.elev': 8,
    'clavicle_*.prot': 6,
    'grip_*.close': 1,
  })
}

function frame(skel: Skeleton, v: Pick<StandCrunch, 'stance' | 'pulley' | 'cable' | 'strand'>, c: number): Float64Array {
  const q = zeroQ(skel)
  body(skel, q, c)
  const measure = (qq: Float64Array) => {
    const f = fk(skel, qq)
    const handle = ropePoses(skel, f, v.pulley, ROPE_FREE, EXIT)[0]
    const { at, force } = cableForce(v.cable, handle)
    return centerOfPressure(skel, f, [], [{ at, force }])[1]
  }
  standBalanced(skel, q, v.stance, legs(c), measure, (qq) => fists(skel, qq, v.strand, STAND_FIST))
  return q
}

const legs = (c: number) => ({ knee: lerp(STAND.knee[0], STAND.knee[1], c), tilt: lerp(STAND.tilt[0], STAND.tilt[1], c) })

export function standCrunchContext(skel: Skeleton, tempo: Tempo): StandCrunch {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  // back to the stack: the pulley high behind the upright head, so curling forwards and down draws the cable out
  const q = zeroQ(skel)
  body(skel, q, 0)
  standBalanced(skel, q, stance, legs(0), (qq) => centerOfPressure(skel, fk(skel, qq))[1])
  const head = toWorld(skel, fk(skel, q), 'head', [0, 0, 0])
  const pulley: V3 = [0, PULLEY_Y, head[2] - PULLEY_BEHIND]
  // the rope leaves the fists towards the pulley as it lies mid-rep (head frame), as in the kneeling crunch
  const qm = zeroQ(skel)
  body(skel, qm, 0.5)
  standBalanced(skel, qm, stance, legs(0.5), (qq) => centerOfPressure(skel, fk(skel, qq))[1])
  const fm = fk(skel, qm)
  const toPulley = qrot(qconj(fm.rot[skel.seg.head]), norm(sub(pulley, toWorld(skel, fm, 'head', [0, FIST[1], FIST[2]]))))
  const strand = norm(add(norm([0, toPulley[1], toPulley[2]]), [-STRAND_IN, 0, 0]))
  const cable: Cable = { pulley, implement: ROPE_IDS.handle, point: [0, 0, 0], kg: CABLE_KG }
  const contacts: Contact[] = [...plantedContacts(skel, stance), ...ropeContacts()]
  const setup: Setup = {
    implements: [...ropeImplements(ROPE_FREE), stackSpec(pulley, [0, 0, -1])],
    contacts,
    tempo,
    symmetric: true,
    cables: [cable],
    balance: { point: 'com', over: 'midfoot', tol: 0.03 },
  }
  return { kind: 'stand', tempo, setup, stance, pulley, cable, strand }
}

export function sampleStandCrunch(skel: Skeleton, v: StandCrunch, c: number): Pose {
  const q = frame(skel, v, c)
  const stack: ImplementPose = { id: 'stack', pos: [0, 0, 0], rot: qid() }
  return { q, implements: [...ropePoses(skel, fk(skel, q), v.pulley, ROPE_FREE, EXIT), stack], contacts: v.setup.contacts }
}

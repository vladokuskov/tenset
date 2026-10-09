import { attachHand } from '../../constraints.ts'
import { bodyCapsules } from '../../collide.ts'
import { fk } from '../../fk.ts'
import { siteWorld, type ImplementSpec } from '../../implements.ts'
import { CAPTAIN, captainsChair } from '../../implements/stations.ts'
import { lerp, qid, smoothstep, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import type { Setup } from '../types.ts'
import { mirrorArm } from './floor.ts'

// Captain's chair knee raise (826, leg-raise support elbow_pads): the body hangs on the forearm pads (upper arms
// straight down, forearms along the pads, hands on the upright handles) with the back on the back pad. The legs hang
// straight at the bottom; the knees rise above hip height, folding to the kneeAngle param, and the pelvis curls up at
// the top (posterior tilt: the lumbar spine flexes, the thorax stays on the pad). Research (motion-authoring): hip
// flexion 0 -> 90-110 deg; the curl at the top and the hang are author judgment.

type P = ParamsOf<'leg-raise'>

/** deg: lumbar flexion bottom -> top (the pelvis curl), thoracic flexion, knee flexion hanging, the shoulders a little
 * elevated by the support, upper arms straight down, elbows at a right angle */
export const CHAIR = { lumbar: [0, 18], thorax: 2, hangKnee: 8, clavicle: 10, elbow: 90 } as const
/** the forearm's underside this far below the elbow joint centre, m (the forearm capsule's radius at the elbow) */
const FOREARM_UNDER = 0.035
/** soft tissue on the pads (forearms, back), mm */
const REST = 18

export type Chair = { kind: 'chair'; tempo: Tempo; setup: Setup; chair: ImplementSpec; pose: ImplementPose; shoulder: V3 }

function body(skel: Skeleton, q: Float64Array, p: P, c: number) {
  const lumbar = lerp(CHAIR.lumbar[0], CHAIR.lumbar[1], smoothstep(Math.max(0, (c - 0.3) / 0.7)))
  const total = lerp(4, p.topHipAngle, c)
  const bent = p.kneeAngle > 30
  setDofs(skel, q, {
    'lumbar.flex': lumbar,
    'thorax.flex': CHAIR.thorax,
    'neck.flex': 4,
    'clavicle_*.elev': CHAIR.clavicle,
    'clavicle_*.prot': 2,
    'hip_*.flex': total - lumbar - CHAIR.thorax,
    'hip_*.abd': 2,
    'knee_*.flex': bent ? lerp(CHAIR.hangKnee, p.kneeAngle, smoothstep(Math.min(1, c * 1.4))) : Math.max(3, p.kneeAngle),
    'ankle_*.df': -20,
    'grip_*.close': 1,
  })
  // the thorax upright against the pad: the pelvis tilts back under it by the spinal flexion
  q[skel.dof['pelvis.tilt']] = -lumbar - CHAIR.thorax
}

/** root so the left shoulder joint sits at `at` */
function place(skel: Skeleton, q: Float64Array, at: V3) {
  const sh = fk(skel, q).pos[skel.seg.humerus_l]
  for (const [k, i] of [['pelvis.tx', 0], ['pelvis.ty', 1], ['pelvis.tz', 2]] as const) q[skel.dof[k]] += at[i] - sh[i]
}

function arms(skel: Skeleton, q: Float64Array, v: Pick<Chair, 'chair' | 'pose'>) {
  const g = siteWorld(v.chair, v.pose, 'handle_l')
  // elbows down and back onto the pads
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: [-1, 0, 0] }, { pole: [0.15, -1, -0.4], planeHint: 80 })
  mirrorArm(skel, q)
}

export function chairContext(p: P, skel: Skeleton, tempo: Tempo): Chair {
  // the ideal arm from a shoulder at the origin: upper arm straight down, forearm forward along the pad
  const q = zeroQ(skel)
  body(skel, q, p, 0)
  setDofs(skel, q, { 'shoulder_*.plane': 90, 'shoulder_*.elev': 4, 'shoulder_*.rot': 0, 'elbow_*.flex': CHAIR.elbow, 'forearm_*.pro': 0 })
  const f = fk(skel, q)
  const sh = f.pos[skel.seg.humerus_l], elbow = f.pos[skel.seg.forearm_l]
  // the back pad's face against the upper back (the thorax capsules' rear), pressed in a few millimetres
  const back = Math.min(...bodyCapsules(skel, f).filter((cp) => cp.segment === 'thorax1' || cp.segment === 'thorax2').map((cp) => Math.min(cp.a[2], cp.b[2]) - cp.r)) + 0.006
  // the chair's forearm pads under the elbows (default height), the back pad behind the thorax
  const chair = captainsChair()
  const lift = CAPTAIN.elbowHeight + FOREARM_UNDER - elbow[1]
  const shoulder: V3 = [sh[0], sh[1] + lift, sh[2]]
  const pose: ImplementPose = { id: chair.id, pos: [0, 0, back], rot: qid() }
  const contacts: Contact[] = [
    { site: 'grip_l', kind: 'grip', target: { implement: chair.id, grip: 'handle_l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: chair.id, grip: 'handle_r' } },
  ]
  const setup: Setup = {
    implements: [chair],
    contacts,
    tempo,
    symmetric: true,
    rests: [{ implement: chair.id, regions: ['forearm_l', 'forearm_r', 'upperarm_l', 'upperarm_r', 'trunk'], tol: REST }],
  }
  return { kind: 'chair', tempo, setup, chair, pose, shoulder }
}

export function sampleChair(skel: Skeleton, p: P, v: Chair, c: number): Pose {
  const q = zeroQ(skel)
  body(skel, q, p, c)
  place(skel, q, v.shoulder)
  arms(skel, q, v)
  return { q, implements: [v.pose], contacts: v.setup.contacts }
}

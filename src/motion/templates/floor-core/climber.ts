import { add, DEG, dist, lerp, lerp3, qaxis, qmul, smoothstep, sub, type V3 } from '../../math.ts'
import { setDofs, type Pose, type Side, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { fk, sitePos } from '../../fk.ts'
import { dls } from '../../ik.ts'
import { legToward } from '../core/floor.ts'
import { flatArm, handPlankContext, sampleHandPlank, type HandPlank } from '../core/hand-plank.ts'
import type { ParamsOf } from '../schemas.ts'
import type { Setup } from '../types.ts'

// Mountain climber (816): the hand plank's high plank (core/hand-plank.ts: palms flat under the shoulders, a straight
// body on the balls of the feet) with one knee driving up under the chest and back (one working leg per loop, the
// eccentric carries it back to the plank). The hips stay level with the shoulders, rising a few centimetres as the
// thigh swings through under them. Research (motion-authoring): hip
// flexion to ~100-110 deg with the knee folded; the angles are author judgment.

type P = ParamsOf<'floor-core'>

/** the driving foot at the top: ankle height and distance ahead of its hip joint, m; the path's lift mid-way, m; the
 * foot's turn towards pointing back, deg */
export const CLIMBER = { footY: 0.25, footAhead: -0.28, arc: 0.06, point: 50 } as const
/** the hips rise this far as the thigh swings through under them and stay up with the knee in (the knee passes
 * clear of the mat), m */
export const LIFT = 0.07

/** a quicker knee drive, about 1.7 s in and back (the motion gates cap it there): the strength tempo's 2 s eccentric reads as a slow step, not a climber
 * (template-own when params.tempo is unset, the swing precedent; lead decision pending) */
export const CLIMBER_TEMPO: Tempo = [0.8, 0, 0.8, 0.1]

export type Climber = { kind: 'climber'; tempo: Tempo; setup: Setup; work: Side; plank: HandPlank }

export function climberContext(p: P, skel: Skeleton, tempo: Tempo): Climber {
  const plank = handPlankContext({ kind: 'front_plank', implement: 'bodyweight', support: 'hand', legs: 'stacked', cableHeight: 'mid', stance: 'hip', pressOut: false, laterality: 'bilateral', side: 'right' }, skel, tempo)
  const work: Side = p.side === 'left' ? 'l' : 'r'
  // the driving foot leaves the mat
  const contacts = plank.setup.contacts.filter((c) => c.site !== `ball_${work}`)
  const setup: Setup = { ...plank.setup, contacts, symmetric: false }
  return { kind: 'climber', tempo, setup, work, plank: { ...plank, setup } }
}

function liftHips(skel: Skeleton, q: Float64Array, v: Climber, o: Side, lift: number) {
  if (lift < 1e-6) return
  const names = ['pelvis.ty', 'pelvis.tz', 'pelvis.tilt', `hip_${o}.flex`, `ankle_${o}.df`]
  const ix = names.map((n) => skel.dof[n]), x0 = ix.map((i) => q[i])
  const f0 = fk(skel, q)
  const ball = sitePos(skel, f0, `ball_${o}`), hipY = f0.pos[skel.seg.femur_l][1]
  const palm = v.plank.palms.sites.l.pos, reach = dist(f0.pos[skel.seg.humerus_l], palm)
  const res = (x: number[]) => {
    ix.forEach((i, k) => (q[i] = x0[k] + x[k]))
    const f = fk(skel, q)
    return [
      ...sub(sitePos(skel, f, `ball_${o}`), ball).map((e) => e * 1000),
      (f.pos[skel.seg.femur_l][1] - hipY - lift) * 1000,
      (dist(f.pos[skel.seg.humerus_l], palm) - reach) * 1000,
      ...x.map((e, k) => e * (k < 2 ? 100 : 1) * 0.02),
    ]
  }
  res(dls(res, [0, 0, 0, 0, 0], { tol: 1e-9, iters: 30 }).x)
}

export function sampleClimber(skel: Skeleton, v: Climber, c: number): Pose {
  const pose = sampleHandPlank(skel, v.plank, 1)
  const w = v.work, o: Side = w === 'l' ? 'r' : 'l'
  // the driving foot as the plank puts it
  const f0 = fk(skel, pose.q)
  const start = { rot: f0.rot[skel.seg[`foot_${w}`]], ankle: f0.pos[skel.seg[`foot_${w}`]] }
  // the hips lift: root, pelvis tilt and the support leg's hip and ankle keep that foot's ball on its spot and the
  // shoulders their distance to the palms (the arms then re-reach the flat palms)
  liftHips(skel, pose.q, v, o, LIFT * smoothstep(Math.min(1, c / 0.55)))
  for (const s of ['l', 'r'] as const) flatArm(skel, pose.q, s, v.plank.palms.sites[s].pos, v.plank.pole)
  // the driving foot travels forward on a low arc to under the hips, toes pointing back, and the leg follows it: the
  // knee comes up under the chest
  const hip = fk(skel, pose.q).pos[skel.seg[`femur_${w}`]]
  const end: V3 = [hip[0] * 0.9, CLIMBER.footY, hip[2] + CLIMBER.footAhead]
  // the path's parameter eases in quadratically: the knee leaves straight without a jolt (near straight, knee flexion
  // grows with the square root of the shortening), and the foot turns to point back early, keeping the ankle in range
  const k = c * c * (2 - c)
  const ankle = add(lerp3(start.ankle, end, k), [0, CLIMBER.arc * Math.sin(Math.PI * k), 0])
  const rot = qmul(qaxis([1, 0, 0], CLIMBER.point * smoothstep(Math.min(1, c * 1.4)) * DEG), start.rot)
  legToward(skel, pose.q, { side: w, rot, ankle }, [0, -1, 0.4])
  setDofs(skel, pose.q, { [`toe_${w}.flex`]: lerp(v.plank.toe, 0, c) })
  return { ...pose, contacts: v.setup.contacts }
}

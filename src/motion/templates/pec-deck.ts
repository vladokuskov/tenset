import { attachHand, plantFoot, root1d, solveLegs, type FootTarget } from '../constraints.ts'
import { bodyCapsules, restAgainst } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { PEC_DECK, pecDeck, pecDeckArm } from '../implements/chest-shoulder-isolation.ts'
import { siteWorld, type ImplementSpec, type Part } from '../implements.ts'
import { add, DEG, dist, lerp, norm, qaxis, qid, scale, type V3 } from '../math.ts'
import { setDofs, shoulderRhythm, zeroQ, type ImplementPose, type Skeleton } from '../skeleton.ts'
import type { Tempo } from '../timing.ts'
import { footContacts, mirrorArm, type Side } from './isolation.ts'
import { setPelvis } from './standing.ts'
import type { Setup } from './types.ts'

// Seated pec deck, both modes (F3). Fly: back against the pad, the arms sweep from open (a little behind the
// shoulders) to the handles together in front of the chest. Rear (reverse pec deck): chest against the pad, the
// arms sweep from straight ahead to in line with the shoulders. The pivots sit over the shoulder joints, so the
// handles circle them at a fixed height and the soft elbow stays nearly constant; the hands are solved onto the
// handles (IK), the machine is placed round the measured body.

export type PecMode = 'fly' | 'rear'

const SEAT_HIP: V3 = [0, 0.56, 0]
/** handle height below the shoulder joints: chest height for the fly, shoulder height for the rear delts, m */
const GRIP_BELOW: Record<PecMode, number> = { fly: 0.14, rear: 0.05 }
/** pivot hubs above the shoulder joints, m */
const HUB_ABOVE = 0.64
/** handles at the front end: centres this far apart, m (two fists for the fly; the reverse mode starts with the
 * arms straight ahead, either side of the column) */
const HANDLE_GAP: Record<PecMode, number> = { fly: 0.1, rear: 0.44 }
/** arm plane at the open end (deg): the fly stretch a little behind the shoulders, the rear delts in line with them */
const OPEN_PLANE: Record<PecMode, number> = { fly: -14, rear: -4 }
/** clavicle protraction at the forward end and the open end, deg (the rear delt rep squeezes the shoulder blades) */
const PROT: Record<PecMode, [number, number]> = { fly: [1, -2], rear: [1, -4] }

export type PecDeckCtx = {
  mode: PecMode
  tempo: Tempo
  setup: Setup
  feet: FootTarget[]
  frame: ImplementSpec
  framePose: ImplementPose
  arms: Record<Side, ImplementSpec>
  pivots: Record<Side, V3>
  /** arm yaw about the pivot (rad) at the forward end and the open end, left arm */
  front: number
  open: number
  elbow: number
}

function body(skel: Skeleton, q: Float64Array, mode: PecMode, c: number, feet?: FootTarget[]) {
  const fly = mode === 'fly'
  const [pf, po] = PROT[mode]
  // c = 1 is the end of the concentric: arms in front for the fly, open for the rear delts
  const open = fly ? 1 - c : c
  setDofs(skel, q, {
    'lumbar.flex': fly ? -2 : 0,
    'thorax.flex': fly ? -2 : 2,
    'neck.flex': fly ? 2 : -4,
    'head.flex': 0,
    'clavicle_*.prot': lerp(pf, po, open),
    'clavicle_*.elev': 0,
    'grip_*.close': 1,
  })
  setPelvis(skel, q, SEAT_HIP, fly ? 0 : 2)
  if (feet) solveLegs(skel, q, feet)
}

function seatedFeet(skel: Skeleton, mode: PecMode): FootTarget[] {
  const femur = skel.segments[skel.seg.femur_l]
  if (mode === 'fly') {
    const x = femur.offset[0] + 0.07
    const z = SEAT_HIP[2] + femur.length + 0.06
    return [plantFoot(skel, 'l', [x, 0, z], 12), plantFoot(skel, 'r', [-x, 0, z], 12)]
  }
  // facing the pad: knees either side of the pad post and column
  const x = femur.offset[0] + 0.12
  const z = SEAT_HIP[2] + femur.length * 0.82
  return [plantFoot(skel, 'l', [x, 0, z], 14), plantFoot(skel, 'r', [-x, 0, z], 14)]
}

/** shoulder joint to grip distance with the elbow bent `elbow` deg */
function reach(skel: Skeleton, elbow: number) {
  const q = zeroQ(skel)
  q[skel.dof['elbow_l.flex']] = elbow
  const f = fk(skel, q)
  return dist(sitePos(skel, f, 'grip_l'), segPos(skel, f, 'humerus_l'))
}

/** arm yaw (rad) for an arm plane of elevation (deg), left arm: 0 = handle straight ahead, + towards the lifter's left */
const yawOf = (plane: number) => (90 - plane) * DEG

export function pecDeckContext(skel: Skeleton, mode: PecMode, o: { elbow: number; tempo: Tempo; symmetric: boolean }): PecDeckCtx {
  const feet = seatedFeet(skel, mode)
  const q = zeroQ(skel)
  body(skel, q, mode, 0.5, feet)
  const caps = bodyCapsules(skel, fk(skel, q))
  const trunk = caps.filter((c) => c.region === 'trunk')
  // the shoulder joints move with the shoulder blades through the rep: pivots over their mean position
  const ghAt = (c: number, s: Side) => {
    const qq = zeroQ(skel)
    body(skel, qq, mode, c, feet)
    for (const k of ['l', 'r'] as const) qq[skel.dof[`scapula_${k}.uprot`]] = shoulderRhythm(80, 45).uprot
    return segPos(skel, fk(skel, qq), `humerus_${s}`)
  }
  const gh = { l: scale(add(ghAt(0, 'l'), ghAt(1, 'l')), 0.5), r: scale(add(ghAt(0, 'r'), ghAt(1, 'r')), 0.5) }
  const fly = mode === 'fly'
  // seat under the pelvis, pad against the back (fly) or the chest (rear)
  const seat = restAgainst(caps.filter((c) => c.region === 'trunk' || /^thigh_[lr]1/.test(c.name)), { shape: 'box', center: [0, SEAT_HIP[1] - 0.15, 0.1], size: [0.36, 0.07, 0.4] } as Part & { shape: 'box' }, [0, -1, 0])
  const seatTop = seat.center[1] + 0.035
  const padZ = restAgainst(trunk, { shape: 'box', center: [0, gh.l[1] - 0.2, fly ? -0.2 : 0.2], size: [0.3, 0.4, 0.001] } as Part & { shape: 'box' }, [0, 0, fly ? -1 : 1]).center[2]
  const pad: [number, number] = fly ? [seatTop + 0.1, gh.l[1] - 0.02] : [gh.l[1] - 0.36, gh.l[1] - 0.1]
  const hubY = gh.l[1] + HUB_ABOVE
  const pivotZ = fly ? gh.l[2] - padZ : padZ - gh.l[2]
  const frame = pecDeck({ seatHeight: seatTop, pad, pivot: { x: gh.l[0], y: hubY, z: pivotZ } })
  // machine frame: +Z is the pad face's normal, towards the lifter's back (fly) or chest (rear)
  const framePose: ImplementPose = { id: frame.id, pos: [0, 0, padZ], rot: fly ? qid() : qaxis([0, 1, 0], Math.PI) }
  const below = GRIP_BELOW[mode]
  const drop = hubY - (gh.l[1] - below) + PEC_DECK.arm.grip / 2
  const open = yawOf(OPEN_PLANE[mode])
  const pivots = { l: [gh.l[0], hubY, gh.l[2]] as V3, r: [gh.r[0], hubY, gh.r[2]] as V3 }
  const arcOf = (radius: number) => ({
    arms: { l: pecDeckArm({ id: 'arm_l', radius, drop }), r: pecDeckArm({ id: 'arm_r', radius, drop }) },
    front: Math.asin(Math.max(-1, Math.min(1, (HANDLE_GAP[mode] / 2 - gh.l[0]) / radius))),
  })
  // arc radius from the zero-pose reach, then corrected so the elbow averages the nominal over the rep once the hand
  // is solved onto the handle: the grip's wrist set-up adds a few mm of reach, and a near-straight elbow is very
  // sensitive to it
  const r0 = reach(skel, o.elbow)
  const radius0 = Math.sqrt(r0 * r0 - below * below)
  const elbowOff = (radius: number) => {
    const trial = { mode, tempo: o.tempo, setup: null as never, feet, frame, framePose, pivots, open, elbow: o.elbow, ...arcOf(radius) }
    const e = [0, 0.5, 1].map((c) => samplePecDeck(skel, trial, c).q[skel.dof['elbow_l.flex']])
    return e.reduce((a, b) => a + b, 0) / e.length - o.elbow
  }
  const { arms, front } = arcOf(root1d(elbowOff, radius0 - 0.03, radius0 + 0.01, { tol: 1e-6 }).x)
  const setup: Setup = {
    implements: [frame, arms.l, arms.r],
    contacts: [
      ...footContacts(skel, feet),
      { site: 'grip_l', kind: 'grip', target: { implement: 'arm_l', grip: 'h' } },
      { site: 'grip_r', kind: 'grip', target: { implement: 'arm_r', grip: 'h' } },
    ],
    tempo: o.tempo,
    symmetric: o.symmetric,
  }
  return { mode, tempo: o.tempo, setup, feet, frame, framePose, arms, pivots, front, open, elbow: o.elbow }
}

/** arm poses at contraction c: fly c = 1 in front, rear c = 1 open */
function armYaw(ctx: PecDeckCtx, c: number) {
  return ctx.mode === 'fly' ? lerp(ctx.open, ctx.front, c) : lerp(ctx.front, ctx.open, c)
}

export function samplePecDeck(skel: Skeleton, ctx: PecDeckCtx, c: number) {
  const q = zeroQ(skel)
  body(skel, q, ctx.mode, c, ctx.feet)
  const th = armYaw(ctx, c)
  const poses: ImplementPose[] = [ctx.framePose]
  for (const s of ['l', 'r'] as const) {
    const t = s === 'l' ? th : -th
    poses.push({ id: ctx.arms[s].id, pos: ctx.pivots[s], rot: qaxis([0, 1, 0], t) })
  }
  const g = siteWorld(ctx.arms.l, poses[1], 'h')
  // palm faces forward along the arc (the handles' fly direction), elbow the other way and a little down
  const fwd: V3 = [-Math.cos(th), 0, Math.sin(th)]
  const pole = norm(add(scale(fwd, -1), [0, -0.35, 0]))
  attachHand(skel, q, 'l', { pos: g.pos, axis: [0, 1, 0], palm: fwd }, { pole, planeHint: 90 - th / DEG })
  mirrorArm(skel, q)
  return { q, implements: poses }
}

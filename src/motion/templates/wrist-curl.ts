import { bodyCapsules } from '../collide.ts'
import { attachHand, handFrame, implementFromHand, root1d } from '../constraints.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { dumbbell, type ImplementSpec } from '../implements.ts'
import { crossBench, DRAWN_BENCH } from '../implements/arms.ts'
import { FLOOR_MAT, floorMat } from '../implements/shared.ts'
import { add, DEG, lerp, norm, qalign, qaxis, qrot, scale, sub, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { setPelvis } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Wrist curl (F8): kneeling on a mat behind a flat bench that stands across the lifter, forearms resting on the pad
// and the wrists just past its far edge. Only the wrists move; upper arms, forearms and body stay still. Palms up
// (708): from full extension, the hands hanging with the dumbbells, to full flexion; palms down (709): from
// flexion to extension, a shorter range against the load. Wrist ranges from the joint limits (Rajagopal model
// flexion/extension +-70) less a margin; the rest is coaching standard (forearms flat, wrists over the edge).

type P = ParamsOf<'wrist-curl'>

const WRIST = {
  kg: 8,
  /** bench top before it is fitted under the forearms, m; forearms sink this far into the pad, m */
  benchTop: 0.44,
  sink: 0.004,
  /** knees on the mat: thighs lean forward of vertical, deg; toes tucked: ankle dorsiflexion and toe bend, deg */
  thigh: 10,
  ankle: 8,
  toes: -30,
  lumbar: 12,
  thorax: 14,
  neck: -24,
  head: -8,
  /** upper arm forward of vertical, deg; elbows this far inside the shoulders, m */
  upperArm: 22,
  armIn: 0.03,
  /** the forearm's axis dips this much towards the wrist (its capsule tapers), deg */
  dip: 4,
  /** kneeling mat, m: length across the lifter, width front to back; its front edge this far ahead of the kneecaps */
  mat: { length: 0.8, width: 0.76, knee: 0.08 },
  /** wrist joint this far past the pad's far edge, m; palms down the flexed hand swings its dumbbell back under the
   * pad, so the wrists sit further out to keep it clear */
  over: { supinated: 0.045, pronated: 0.07 } as Record<'supinated' | 'pronated', number>,
  /** palms turned in from level, deg: full supination and pronation sit at the joint limits */
  palmIn: 14,
  /** wrist flexion (deg, + towards the palm) at the stretch and at the top */
  range: { supinated: [-55, 60], pronated: [55, -45] } as Record<'supinated' | 'pronated', [number, number]>,
}

type Ctx = {
  tempo: Tempo
  setup: Setup
  /** the still pose: body and arms with the wrists straight */
  q: Float64Array
  flex0: number
  range: [number, number]
  db: ImplementSpec[]
  bench: ImplementPose
  mat: ImplementPose
}

function kneel(skel: Skeleton, q: Float64Array, hip: V3, tilt: number) {
  const hipFlex = tilt + WRIST.thigh
  setDofs(skel, q, {
    'lumbar.flex': WRIST.lumbar,
    'thorax.flex': WRIST.thorax,
    'neck.flex': WRIST.neck,
    'head.flex': WRIST.head,
    'clavicle_*.prot': 6,
    'hip_*.flex': hipFlex,
    'hip_*.abd': 3,
    // shin from the knee back along the floor (feet() lifts it onto the balls of the feet)
    'knee_*.flex': 90 + WRIST.thigh,
    'ankle_*.df': WRIST.ankle,
    'toe_*.flex': WRIST.toes,
    'grip_*.close': 1,
  })
  setPelvis(skel, q, hip, tilt)
}

/** toes tucked: the shin rises from the knee until the forefoot rests on the mat */
function feet(skel: Skeleton, q: Float64Array, top: number) {
  for (const s of ['l', 'r']) {
    const k = skel.dof[`knee_${s}.flex`]
    const base = q[k]
    q[k] = root1d((a) => {
      q[k] = a
      const foot = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === `foot_${s}`)
      return Math.min(...foot.map((c) => Math.min(c.a[1], c.b[1]) - c.r)) - (top - WRIST.sink)
    }, base, base + 45, { tol: 1e-7 }).x
  }
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  if (p.implement !== 'dumbbell' || p.posture !== 'kneeling' || p.support !== 'bench') {
    throw new Error(`wrist-curl: variant not implemented yet (${p.implement}/${p.posture}/${p.support})`)
  }
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const grip = p.grip === 'pronated' ? 'pronated' : 'supinated'
  const matTop = FLOOR_MAT.thick
  // knees on the mat: pelvis height for a trunk tilt
  const placed = (tilt: number) => {
    const at = (y: number) => {
      const q = zeroQ(skel)
      kneel(skel, q, [0, y, 0], tilt)
      return q
    }
    const y = root1d((yy) => {
      const legs = bodyCapsules(skel, fk(skel, at(yy))).filter((c) => /^(shank|thigh)_/.test(c.region))
      return Math.min(...legs.map((c) => Math.min(c.a[1], c.b[1]) - c.r)) - (matTop - WRIST.sink)
    }, 0.3, 1.0, { tol: 1e-7 }).x
    return at(y)
  }
  const l1 = skel.segments[skel.seg.humerus_l].length
  const l2 = skel.segments[skel.seg.forearm_l].length
  const b = WRIST.upperArm * DEG
  // trunk tilt that brings the shoulders the upper arm's height above the elbows on the pad
  const elbowY = WRIST.benchTop + 0.035
  const tilt = root1d((t) => segPos(skel, fk(skel, placed(t)), 'humerus_l')[1] - l1 * Math.cos(b) - elbowY, 0, 90, { tol: 1e-7 }).x
  const q = placed(tilt)
  feet(skel, q, matTop)
  const S = segPos(skel, fk(skel, q), 'humerus_l')
  const E = add(S, [-WRIST.armIn, -l1 * Math.cos(b), l1 * Math.sin(b)])
  const f: V3 = [0, -Math.sin(WRIST.dip * DEG), Math.cos(WRIST.dip * DEG)]
  const W = add(E, scale(f, l2))
  // the hand straight on: fingers along the forearm, palm up (or down), turned in a little
  const site = skel.data.sites.grip_l
  const inward = qaxis(f, (grip === 'supinated' ? -1 : 1) * WRIST.palmIn * DEG)
  const palm = qrot(inward, grip === 'supinated' ? [0, 1, 0] : [0, -1, 0])
  const hand = qalign([0, -1, 0], site.normal!, f, palm)
  const gripAt = add(W, qrot(hand, site.local))
  attachHand(skel, q, 'l', { pos: gripAt, axis: qrot(hand, site.axis!), palm, hand }, { pole: sub(E, add(S, scale(norm(sub(W, S)), l1))), planeHint: 90 })
  for (const k of ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']) {
    q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
  }
  // the bench under the forearms: its top where they rest, its far edge just short of the wrists
  const F = fk(skel, q)
  const fore = bodyCapsules(skel, F).filter((c) => c.region === 'forearm_l' || c.region === 'forearm_r')
  const top = Math.min(...fore.map((c) => Math.min(c.a[1], c.b[1]) - c.r)) + WRIST.sink
  const wrist = segPos(skel, F, 'hand_l')
  const center = wrist[2] - WRIST.over[grip] - DRAWN_BENCH.back.width / 2
  // across the lifter: the bench's own +Z (the seat end) points to the lifter's left, the back pad centred on him
  const benchSpec = crossBench({ seatHeight: top })
  const bench: ImplementPose = { id: benchSpec.id, pos: [DRAWN_BENCH.gap + DRAWN_BENCH.back.len / 2, top, center], rot: qaxis([0, 1, 0], Math.PI / 2) }
  // a short mat across, under the knees and feet: its front edge well ahead of the kneecaps (the leg capsules' front
  // where they meet the mat), the tucked toes inside its back edge
  const legs = bodyCapsules(skel, F).filter((c) => /^(thigh|shank)_/.test(c.region))
  const kneecap = Math.max(...legs.flatMap((c) => [c.a, c.b].filter((e) => e[1] - c.r < 0.03).map((e) => e[2] + c.r)))
  const { length, width } = WRIST.mat
  const matSpec = floorMat({ id: 'mat', length, width })
  const mat: ImplementPose = { id: 'mat', pos: [0, 0, kneecap + WRIST.mat.knee - width / 2], rot: qaxis([0, 1, 0], Math.PI / 2) }
  const db = [dumbbell({ id: 'db_l', mass: WRIST.kg }), dumbbell({ id: 'db_r', mass: WRIST.kg })]
  const contacts: Contact[] = [
    ...(['l', 'r'] as const).map((s): Contact => ({ site: `ball_${s}`, kind: 'planted', target: { world: sitePos(skel, F, `ball_${s}`) } })),
    { site: 'grip_l', kind: 'grip', target: { implement: 'db_l', grip: 'c' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'db_r', grip: 'c' } },
  ]
  const setup: Setup = { implements: [...db, benchSpec, matSpec], contacts, tempo, symmetric: true }
  return { tempo, setup, q, flex0: q[skel.dof['wrist_l.flex']], range: WRIST.range[grip], db, bench, mat }
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const v = context(p, skel)
  const c = phaseAt(u, v.tempo).c
  const q = Float64Array.from(v.q)
  const flex = v.flex0 + lerp(v.range[0], v.range[1], c)
  setDofs(skel, q, { 'wrist_*.flex': flex })
  const F = fk(skel, q)
  const dbs = v.db.map((spec, k): ImplementPose => {
    const h = handFrame(skel, F, k === 0 ? 'l' : 'r')
    return { id: spec.id, pos: h.pos, rot: implementFromHand(h.axis, h.palm) }
  })
  return { q, implements: [...dbs, v.bench, v.mat], contacts: v.setup.contacts }
}

export const wristCurl: Template<P> = {
  id: 'wrist-curl',
  driver: 'joint',
  params: SCHEMAS['wrist-curl'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}

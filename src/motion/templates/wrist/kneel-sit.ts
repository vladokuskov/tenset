import { bodyCapsules, capsuleClearance } from '../../collide.ts'
import { attachHand, root1d } from '../../constraints.ts'
import { fk, segPos, sitePos } from '../../fk.ts'
import { cableHandle, type ImplementSpec } from '../../implements.ts'
import { FLOOR_MAT, floorMat } from '../../implements/shared.ts'
import { add, cross, DEG, lerp, norm, qaxis, qalign, qfromBasis, qrot, scale, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'

// Cable wrist curl, kneeling (748): kneeling on a mat facing a low pulley and sitting back towards the heels, the
// forearms resting along the thighs, palms up, the wrists just past the knees, a straight bar on the cable. Only the
// wrists move: the cable draws the hands down and forward into extension, then the wrists curl the bar up. The knees
// bend ~140 deg (the model's knee stops at 150, so the hips stay a little above the heels; the cue's "sit back on your
// heels"). Wrist range as the kneeling wrist curls (joint limits less a margin); the rest is coaching standard.

type P = ParamsOf<'wrist-curl'>

const KS = {
  /** thighs forward of vertical, deg; the shins rise this much from the knees back to the ankles, deg */
  thigh: 58,
  shinRise: 8,
  /** kneeling back towards the heels takes the knees past the model's 150 deg stop (passive kneel-sitting ~155-160) */
  kneeLimit: [0, 158] as [number, number],
  /** feet pointed, the instep towards the mat, deg */
  ankle: -50,
  hipAbd: 4,
  lumbar: 14,
  thorax: 16,
  neck: -26,
  head: -8,
  sink: 0.004,
  /** wrist joint this far past the knee along the thigh, m; the forearms' gap to the thighs (- sinks), m: ~2 cm, since
   * resting lower (the thighs slope ~32 deg down to the knees) puts the hands into the floor and the shins at the stretch */
  over: 0.04,
  rest: -0.02,
  /** elbows' pole a little out to the sides, so the upper arms come down beside the trunk */
  elbowOut: 0.15,
  /** palms turned in from level, deg (full supination sits at the joint limit) */
  palmIn: 14,
  /** wrist flexion (deg, + towards the palm) at the stretch and at the top: the stretch stops short of the bench curls'
   * -55, where the hands would reach the floor */
  range: [-26, 55] as [number, number],
  /** low pulley: height, and this far ahead of the wrists, m */
  pulley: { y: 0.1, ahead: 0.45 },
  kg: 10,
  mat: { length: 0.9, width: 0.6 },
}

export type KneelSit = {
  tempo: Tempo
  setup: Setup
  q: Float64Array
  flex0: number
  half: number
  handle: ImplementSpec
  pulley: V3
  mat: ImplementPose
}

function kneel(skel: Skeleton, q: Float64Array, hip: V3, tilt: number) {
  setDofs(skel, q, {
    'lumbar.flex': KS.lumbar,
    'thorax.flex': KS.thorax,
    'neck.flex': KS.neck,
    'head.flex': KS.head,
    'clavicle_*.prot': 6,
    'hip_*.flex': tilt + KS.thigh,
    'hip_*.abd': KS.hipAbd,
    'knee_*.flex': 90 + KS.thigh + KS.shinRise,
    'ankle_*.df': KS.ankle,
    'grip_*.close': 1,
  })
  setPelvis(skel, q, hip, tilt)
}

const lowest = (skel: Skeleton, q: Float64Array, re: RegExp) =>
  Math.min(...bodyCapsules(skel, fk(skel, q)).filter((c) => re.test(c.region)).map((c) => Math.min(c.a[1], c.b[1]) - c.r))

/** the straight bar attachment between the hands (origin at the carabiner, bar along X 5 cm below) */
function straightBar(half: number): ImplementSpec {
  const base = cableHandle({ id: 'handle', attachment: 'straight_bar' })
  const w = Math.max(0.25, half + 0.07)
  const cyl = (a: V3, b: V3, r: number) => ({ shape: 'cylinder' as const, a, b, r })
  return { ...base, parts: [cyl([0, 0, 0], [0, -0.05, 0], 0.01), cyl([-w, -0.05, 0], [w, -0.05, 0], 0.014)], sites: { l: { pos: [half, -0.05, 0], axis: [1, 0, 0] }, r: { pos: [-half, -0.05, 0], axis: [1, 0, 0] } } }
}

export function kneelSitContext(_p: P, skel: Skeleton, tempo: Tempo): KneelSit {
  const matTop = FLOOR_MAT.thick
  const placed = (tilt: number) => {
    const at = (y: number) => {
      const q = zeroQ(skel)
      kneel(skel, q, [0, y, 0], tilt)
      return q
    }
    return at(root1d((y) => lowest(skel, at(y), /^(shank|thigh)_/) - (matTop - KS.sink), 0.1, 1.0, { tol: 1e-7 }).x)
  }
  const l1 = skel.segments[skel.seg.humerus_l].length
  const l2 = skel.segments[skel.seg.forearm_l].length
  // the left forearm along the top of the left thigh, the wrist KS.over past the knee, `drop` m lower than a first guess
  const forearmOn = (q: Float64Array, drop: number) => {
    const f = fk(skel, q)
    const hip = segPos(skel, f, 'femur_l'), knee = segPos(skel, f, 'tibia_l')
    const dir = norm(sub(knee, hip))
    const caps = bodyCapsules(skel, f)
    const thigh = caps.filter((c) => c.region === 'thigh_l')
    const fore = caps.find((c) => c.region === 'forearm_l')!
    const up = norm(sub([0, 1, 0], scale(dir, dir[1])))
    const r = Math.max(...thigh.map((c) => c.r))
    const W = add(add(knee, scale(dir, KS.over)), scale(up, r * 0.75 + fore.r - drop))
    return { W, E: sub(W, scale(dir, l2)), dir }
  }
  const site = skel.data.sites.grip_l
  const pose = (drop: number) => {
    // trunk lean that puts the shoulder an upper arm from the elbow on the thigh
    const tilt = root1d((t) => {
      const q = placed(t)
      const { E } = forearmOn(q, drop)
      return Math.hypot(...sub(segPos(skel, fk(skel, q), 'humerus_l'), E)) - l1
    }, -10, 80, { tol: 1e-6 }).x
    const q = placed(tilt)
    const { W, E, dir } = forearmOn(q, drop)
    const palm = qrot(qaxis(dir, -KS.palmIn * DEG), norm(sub([0, 1, 0], scale(dir, dir[1]))))
    const hand = qalign([0, -1, 0], site.normal!, dir, palm)
    const S = segPos(skel, fk(skel, q), 'humerus_l')
    attachHand(skel, q, 'l', { pos: add(W, qrot(hand, site.local)), axis: qrot(hand, site.axis!), palm, hand }, { pole: add(sub(E, add(S, scale(norm(sub(W, S)), l1))), [KS.elbowOut, 0, 0]), planeHint: 90 })
    const caps = bodyCapsules(skel, fk(skel, q))
    const gap = Math.min(...caps.filter((c) => c.region === 'forearm_l').flatMap((a) => caps.filter((c) => c.region === 'thigh_l').map((t) => capsuleClearance(a, t))))
    return { q, gap, W }
  }
  // the forearms' gap to the thighs settles at -KS.rest in two passes
  let drop = 0
  for (let i = 0; i < 2; i++) drop += pose(drop).gap + KS.rest
  const { q, W } = pose(drop)
  for (const k of ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']) {
    q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
  }
  const F = fk(skel, q)
  const half = sitePos(skel, F, 'grip_l')[0]
  const handle = straightBar(half)
  const pulley: V3 = [0, KS.pulley.y, W[2] + KS.pulley.ahead]
  const stack: ImplementSpec = {
    id: 'stack',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [{ shape: 'cylinder', a: [0, 0, pulley[2] + 0.12], b: [0, 2.1, pulley[2] + 0.12], r: 0.05 }, { shape: 'cylinder', a: pulley, b: [0, pulley[1], pulley[2] + 0.12], r: 0.04 }],
    sites: {},
  }
  // mat under the knees and shins
  const knees = segPos(skel, F, 'tibia_l')
  const matSpec = floorMat({ id: 'mat', length: KS.mat.length, width: KS.mat.width })
  const mat: ImplementPose = { id: 'mat', pos: [0, 0, knees[2] + 0.1 - KS.mat.length / 2], rot: [0, 0, 0, 1] }
  const contacts: Contact[] = [
    ...(['l', 'r'] as const).map((s): Contact => ({ site: `ball_${s}`, kind: 'planted', target: { world: sitePos(skel, F, `ball_${s}`) } })),
    { site: 'grip_l', kind: 'grip', target: { implement: 'handle', grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'handle', grip: 'r' } },
  ]
  const setup: Setup = {
    implements: [handle, stack, matSpec],
    contacts,
    tempo,
    symmetric: true,
    cables: [{ pulley, implement: 'handle', point: [0, 0, 0], kg: KS.kg }],
    limits: { 'knee_l.flex': KS.kneeLimit, 'knee_r.flex': KS.kneeLimit },
    rests: [{ implement: 'mat', regions: ['thigh_l', 'thigh_r', 'shank_l', 'shank_r', 'foot_l', 'foot_r'], tol: 10 }],
  }
  return { tempo, setup, q, flex0: q[skel.dof['wrist_l.flex']], half, handle, pulley, mat }
}

export function sampleKneelSit(u: number, skel: Skeleton, v: KneelSit): Pose {
  const q = Float64Array.from(v.q)
  setDofs(skel, q, { 'wrist_*.flex': v.flex0 + lerp(KS.range[0], KS.range[1], phaseAt(u, v.tempo).c) })
  // the palms turn in a little, so flexion swings the hands sideways; deviation keeps them on the bar's spacing
  const dl = skel.dof['wrist_l.dev'], dr = skel.dof['wrist_r.dev']
  q[dl] = root1d((d) => {
    q[dl] = d
    return sitePos(skel, fk(skel, q), 'grip_l')[0] - v.half
  }, -30, 18, { tol: 1e-7 }).x
  q[dr] = q[dl]
  const F = fk(skel, q)
  const gl = sitePos(skel, F, 'grip_l'), gr = sitePos(skel, F, 'grip_r')
  const c = scale(add(gl, gr), 0.5)
  const x = norm(sub(gl, gr))
  const y = norm(cross(cross(x, sub(v.pulley, c)), x))
  const rot = qfromBasis(x, y)
  return { q, implements: [{ id: 'handle', pos: sub(c, qrot(rot, [0, -0.05, 0])), rot }, { id: 'stack', pos: [0, 0, 0], rot: [0, 0, 0, 1] }, v.mat], contacts: v.setup.contacts }
}

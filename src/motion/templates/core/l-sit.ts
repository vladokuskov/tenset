import { attachHand, root1d } from '../../constraints.ts'
import { centerOfMass, fk } from '../../fk.ts'
import { siteWorld, type ImplementSpec } from '../../implements.ts'
import { dipBars } from '../../implements/press-vertical-bodyweight.ts'
import { lerp, norm, qid } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { mirrorArm } from './floor.ts'
import { naturalCubic, secant } from '../solve.ts'
import type { Setup } from '../types.ts'

// L-sit hold (835) as a breathing hold: supported between parallel dip bars on locked arms, the shoulders pushed down
// (depressed), the trunk upright with the lower back a little rounded, straight legs held out level with the hips and
// the toes pointed. The body's centre of mass sits over the hands. The breath (core/plank.ts): the slow eccentric
// inhales and the legs settle a degree or two, the quick concentric exhales and lifts them. Research
// (motion-authoring): hip flexion ~90 deg with the pelvis tilted back; the angles are author judgment.

/** deg, settled -> braced: legs' angle above level, pelvis tilt (back), lumbar flexion, shoulder depression (clavicle
 * elevation, negative), elbow, knee, ankle */
export const L_SIT = { legs: [-3, 0], tilt: -14, lumbar: [10, 12], thorax: 4, clavicle: -8, elbow: 7, knee: 2, ankle: -40, neck: 8 } as const

export type LSit = { kind: 'l_sit'; tempo: Tempo; setup: Setup; bars: ImplementSpec; barsPose: ImplementPose; root: (c: number) => [number, number] }

function body(skel: Skeleton, q: Float64Array, c: number) {
  const lumbar = lerp(L_SIT.lumbar[0], L_SIT.lumbar[1], c)
  setDofs(skel, q, {
    'lumbar.flex': lumbar,
    'thorax.flex': L_SIT.thorax,
    'neck.flex': L_SIT.neck,
    'clavicle_*.elev': L_SIT.clavicle,
    'clavicle_*.prot': 4,
    // the thighs level (plus the breath): the pelvis's tilt back already raises them
    'hip_*.flex': 90 + L_SIT.tilt + lerp(L_SIT.legs[0], L_SIT.legs[1], c),
    'hip_*.abd': 0,
    'knee_*.flex': L_SIT.knee,
    'ankle_*.df': L_SIT.ankle,
    'grip_*.close': 1,
  })
  q[skel.dof['pelvis.tilt']] = L_SIT.tilt
}

function arms(skel: Skeleton, q: Float64Array, bars: ImplementSpec, pose: ImplementPose) {
  const g = siteWorld(bars, pose, 'l')
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: [-1, 0, 0] }, { pole: norm([0.3, 0.1, -1]), wristBias: 20, planeHint: 0 })
  mirrorArm(skel, q)
}

/** root height and depth: the elbows at L_SIT.elbow and the centre of mass over the grips */
function place(skel: Skeleton, bars: ImplementSpec, pose: ImplementPose, c: number, guess: [number, number]): { q: Float64Array; x: [number, number] } {
  const q = zeroQ(skel)
  const at = (y: number, z: number) => {
    body(skel, q, c)
    q[skel.dof['pelvis.ty']] = y
    q[skel.dof['pelvis.tz']] = z
    arms(skel, q, bars, pose)
  }
  let y = guess[0]
  const elbowAt = (z: number) => (yy: number) => (at(yy, z), q[skel.dof['elbow_l.flex']] - L_SIT.elbow)
  const comAt = (z: number) => {
    y = root1d(elbowAt(z), guess[0] - 0.25, guess[0] + 0.15, { tol: 1e-7, scan: 9 }).x
    at(y, z)
    return centerOfMass(skel, fk(skel, q))[2] - pose.pos[2]
  }
  const z = secant(comAt, guess[1], guess[1] - 0.02, 1e-7)
  comAt(z)
  return { q, x: [y, z] }
}

export function lSitContext(skel: Skeleton, tempo: Tempo): LSit {
  const bars = dipBars()
  const barsPose: ImplementPose = { id: bars.id, pos: [0, 0, 0], rot: qid() }
  // root height and depth solved at a few knots of the breath and splined
  const cs = [0, 0.25, 0.5, 0.75, 1]
  let guess: [number, number] = [1.45, -0.18]
  const xs = cs.map((c) => (guess = place(skel, bars, barsPose, c, guess).x))
  const [ys, zs] = [0, 1].map((k) => naturalCubic(cs, xs.map((x) => x[k])))
  const root = (c: number): [number, number] => [ys(c), zs(c)]
  const contacts: Contact[] = [
    { site: 'grip_l', kind: 'grip', target: { implement: bars.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: bars.id, grip: 'r' } },
  ]
  const setup: Setup = { implements: [bars], contacts, tempo, symmetric: true, balance: { point: 'com', over: { implement: bars.id, sites: ['l', 'r'] }, tol: 0.02 } }
  return { kind: 'l_sit', tempo, setup, bars, barsPose, root }
}

export function sampleLSit(skel: Skeleton, v: LSit, c: number): Pose {
  const q = zeroQ(skel)
  body(skel, q, c)
  ;[q[skel.dof['pelvis.ty']], q[skel.dof['pelvis.tz']]] = v.root(c)
  arms(skel, q, v.bars, v.barsPose)
  return { q, implements: [v.barsPose], contacts: v.setup.contacts }
}

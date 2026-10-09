import { bodyCapsules, type Capsule } from '../../collide.ts'
import { attachHand, root1d } from '../../constraints.ts'
import { centerOfMass, fk, sitePos, type FK } from '../../fk.ts'
import { barbell, type ImplementSpec } from '../../implements.ts'
import { add, lerp, norm, qconj, qid, qrot, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { mirrorArm } from '../isolation.ts'
import type { ParamsOf } from '../schemas.ts'
import { ARM_BALANCE_TOL, limitSway, makeStance, plantedContacts, stand, stanceWidth, standBalanced, type StanceSetup, type Sway } from '../standing.ts'
import type { Setup } from '../types.ts'

// Drag curl (723): the bar stays against the body the whole way. Instead of the forearms swinging the bar out on an
// arc, the elbows travel back (shoulder extension) while the bar slides up the front of the thighs and belly to the
// lower chest. The bar path is the body's front profile measured once from the capsules, a few mm off it, carried
// with the thorax; the arms are solved onto the bar with the elbows pointing back.

type P = ParamsOf<'curl'>

const DRAG = {
  /** plates per side, kg (the barbell curl's) */
  plateKg: 5,
  /** bar surface this far off the body's front, m (the cue: brushing the torso) */
  clear: 0.006,
  /** elbow flexion at the bottom, deg (the bar resting on the thighs, arms all but straight) */
  bottom: 12,
  /** top: bar centre this far below the sternum site, m (lower chest) */
  top: 0.2,
  knee: 6,
  tilt: 2,
  /** elbow pole sideways component at the bottom and top (forward is -1) */
  flare: [0.35, 0.35],
  /** wrist deviation band, deg: the full supination of a bar held palms up with the elbows back leans on it */
  dev: [-30, 14] as [number, number],
}
const BAR_R = 0.014
const N = 48

export type Drag = {
  tempo: Tempo
  setup: Setup
  stance: StanceSetup
  bar: ImplementSpec
  /** bar centre path, thorax2 frame of the reference pose, for c = k / N */
  path: V3[]
  sway?: Sway
}

function base(skel: Skeleton) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': -1, 'thorax.flex': 1, 'neck.flex': -3, 'clavicle_*.prot': -3, 'grip_*.close': 1 })
  return q
}

/** frontmost z of these capsules at height y (m), or -Infinity */
function frontAt(caps: Capsule[], y: number) {
  let z = -Infinity
  for (const c of caps) {
    for (let k = 0; k <= 24; k++) {
      const p = add(c.a, [(c.b[0] - c.a[0]) * k / 24, (c.b[1] - c.a[1]) * k / 24, (c.b[2] - c.a[2]) * k / 24])
      const dy = p[1] - y
      if (Math.abs(dy) < c.r) z = Math.max(z, p[2] + Math.sqrt(c.r * c.r - dy * dy))
    }
  }
  return z
}

const toLocal = (f: FK, skel: Skeleton, w: V3): V3 => qrot(qconj(f.rot[skel.seg.thorax2]), sub(w, f.pos[skel.seg.thorax2]))
const toWorld = (f: FK, skel: Skeleton, l: V3): V3 => add(f.pos[skel.seg.thorax2], qrot(f.rot[skel.seg.thorax2], l))

function barAt(skel: Skeleton, f: FK, v: Drag, c: number): V3 {
  const x = Math.min(N - 1e-9, Math.max(0, c * N))
  const k = Math.floor(x)
  const a = v.path[k], b = v.path[Math.min(N, k + 1)]
  const t = x - k
  return toWorld(f, skel, [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)])
}

/** both hands on the bar at `center`, elbows pointing back and a little out (left solved, right mirrored) */
function arms(skel: Skeleton, q: Float64Array, v: Drag, center: V3, c: number) {
  const f = fk(skel, q)
  const g = v.bar.sites.l.pos[0]
  // the elbows flare as they travel back, so they pass beside the ribs instead of into them
  const pole = qrot(f.rot[skel.seg.thorax2], norm([lerp(DRAG.flare[0], DRAG.flare[1], c), -0.3, -1]))
  attachHand(skel, q, 'l', { pos: add(center, [g, 0, 0]), axis: [1, 0, 0], palm: norm([0, 1, 1]) }, { pole, planeHint: 0, devBand: DRAG.dev })
  mirrorArm(skel, q)
}

function frame(skel: Skeleton, q: Float64Array, v: Drag, c: number, sway?: Sway) {
  const upper = (qq: Float64Array) => arms(skel, qq, v, barAt(skel, fk(skel, qq), v, c), c)
  const measure = (qq: Float64Array) => {
    const f = fk(skel, qq)
    return centerOfMass(skel, f, [{ mass: v.bar.mass, pos: barAt(skel, f, v, c) }])[2]
  }
  const bal = standBalanced(skel, q, v.stance, { knee: DRAG.knee, tilt: DRAG.tilt }, measure, upper, undefined, sway)
  return { bal, pose: { id: v.bar.id, pos: barAt(skel, fk(skel, q), v, c), rot: qid() } as ImplementPose }
}

export function dragContext(p: P, skel: Skeleton, tempo: Tempo): Drag {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const bar = barbell({ gripWidth: p.gripWidth * skel.data.shoulderWidth, plateKg: DRAG.plateKg })
  const contacts = plantedContacts(skel, stance)
  contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: bar.id, grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: bar.id, grip: 'r' } })
  const setup: Setup = { implements: [bar], contacts, tempo, symmetric: true, balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL } }
  // reference body: standing, arms hanging; the front profile of the trunk and thighs, and the hanging grip height
  const q = base(skel)
  stand(skel, q, stance, { knee: DRAG.knee, df: 0, tilt: DRAG.tilt })
  setDofs(skel, q, { 'shoulder_*.plane': 90, 'shoulder_*.elev': 0, 'elbow_*.flex': 10 })
  const f = fk(skel, q)
  const caps = bodyCapsules(skel, f).filter((k) => k.region === 'trunk' || k.region.startsWith('thigh_'))
  const y1 = sitePos(skel, f, 'sternum')[1] - DRAG.top
  const v: Drag = { tempo, setup, stance, bar, path: [] }
  const build = (y0: number) => {
    v.path = []
    for (let k = 0; k <= N; k++) {
      const y = lerp(y0, y1, k / N)
      v.path.push(toLocal(f, skel, [0, y, frontAt(caps, y) + BAR_R + DRAG.clear]))
    }
  }
  // the bottom height where the arms reach the bar with the elbows DRAG.bottom short of straight
  const grip = sitePos(skel, f, 'grip_l')[1]
  const elbowAt = (y0: number) => {
    build(y0)
    const qq = base(skel)
    frame(skel, qq, v, 0)
    return qq[skel.dof['elbow_l.flex']] - DRAG.bottom
  }
  build(root1d(elbowAt, grip - 0.02, grip + 0.12, { tol: 1e-5 }).x)
  v.sway = limitSway((u, sway) => frame(skel, base(skel), v, phaseAt(u, tempo).c, sway).bal)
  return v
}

export function sampleDrag(u: number, skel: Skeleton, v: Drag): Pose {
  const q = base(skel)
  const { pose } = frame(skel, q, v, phaseAt(u, v.tempo).c, v.sway)
  return { q, implements: [pose], contacts: v.setup.contacts }
}

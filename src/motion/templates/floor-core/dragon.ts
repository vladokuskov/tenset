import { attachHand } from '../../constraints.ts'
import { bodyCapsules, type Capsule } from '../../collide.ts'
import { fk, segPos } from '../../fk.ts'
import type { ImplementSpec } from '../../implements.ts'
import { palmRest } from '../../implements/core.ts'
import { flatBench } from '../../implements/shared.ts'
import { add, lerp, norm, qid, scale, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import type { Setup } from '../types.ts'
import { lyingTilt } from './common.ts'

// Dragon flag (839) on a flat bench: lying face up, head towards the bench's head end (-Z), the hands gripping the
// pad's end behind the head. The body stays one straight line from the shoulders to the feet (no bend at the hips) and
// pivots on the upper back: from just above the bench (bottom, after the slow lowering) up to steep (top). The neck
// flexes as the body rises; up high the weight sits on the upper back and the back of the head. Research (motion-authoring): anti-extension; the body line angle is author
// judgment (the record's cue: only the upper back touches the bench).

/** body line above the bench, deg: bottom (lowered) -> top; slight thoracic flexion; neck flexion (the line past the
 * first value, up to the second; the head follows at half) */
export const DRAGON = { line: [12, 55], thorax: 10, neck: [6, 45], ankle: -40 } as const
/** bench seat height (pad top), m; the shoulders this far from the pad's head end, m; the pad sinks under the back, m */
const BENCH = { seat: 0.43, head: 0.34, sink: 0.008 }
/** hands round the pad's end behind the head: grip sites from the pad end's top edge (x out, y below, z beyond), m */
const GRIP: V3 = [0.1, -0.01, -0.028]

export type Dragon = { kind: 'dragon'; tempo: Tempo; setup: Setup; tilt0: number; bench: ImplementSpec; benchPose: ImplementPose; top: number; shoulderZ: number; palms: ImplementSpec }

const UPPER_BACK = (c: Capsule) => c.segment === 'thorax2' || c.segment === 'thorax1' || c.region === 'head'

function body(skel: Skeleton, q: Float64Array, v: Pick<Dragon, 'tilt0' | 'top' | 'shoulderZ'>, c: number) {
  const line = lerp(DRAGON.line[0], DRAGON.line[1], c)
  setDofs(skel, q, {
    'lumbar.flex': 0,
    'thorax.flex': DRAGON.thorax,
    'hip_*.flex': 0,
    'hip_*.abd': 0,
    'knee_*.flex': 2,
    'ankle_*.df': DRAGON.ankle,
    'clavicle_*.elev': 10,
    'clavicle_*.prot': 0,
    'grip_*.close': 1,
    // chin towards the chest as the body rises, so the back of the head stays on the pad
    'neck.flex': Math.min(DRAGON.neck[1], Math.max(0, line - DRAGON.neck[0])),
    'head.flex': 0.5 * Math.min(DRAGON.neck[1], Math.max(0, line - DRAGON.neck[0])),
  })
  // the feet rise towards +Z: the pelvis turns further back from lying flat
  q[skel.dof['pelvis.tilt']] = v.tilt0 - line
  // the shoulders over their spot, the upper back resting on the pad
  const d = skel.dof
  let f = fk(skel, q)
  const sh = scale(add(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r')), 0.5)
  q[d['pelvis.tz']] += v.shoulderZ - sh[2]
  for (let k = 0; k < 3; k++) {
    f = fk(skel, q)
    const low = Math.min(...bodyCapsules(skel, f).filter(UPPER_BACK).map((cp) => Math.min(cp.a[1], cp.b[1]) - cp.r))
    q[d['pelvis.ty']] -= low - (v.top - BENCH.sink)
  }
}

function arms(skel: Skeleton, q: Float64Array, palms: ImplementSpec) {
  for (const side of ['l', 'r'] as const) {
    const s = side === 'l' ? 1 : -1
    // fingers over the pad's end, palms towards the pad and down; elbows up and out
    attachHand(skel, q, side, { pos: palms.sites[side].pos, axis: [1, 0, 0], palm: norm([0, 0.5, 0.85]) }, { pole: [s * 0.3, 1, -0.3], planeHint: 120 })
  }
}

export function dragonContext(skel: Skeleton, tempo: Tempo): Dragon {
  const tilt0 = lyingTilt(skel, 0)
  const top = BENCH.seat
  const bench = flatBench({ id: 'bench', seatHeight: BENCH.seat })
  // the pad's head end at z = -0.84 from the bench origin; the shoulders BENCH.head from it
  const shoulderZ = 0
  const benchPose: ImplementPose = { id: bench.id, pos: [0, top, shoulderZ + 0.84 - BENCH.head], rot: qid() }
  const end = benchPose.pos[2] - 0.84
  const palms = palmRest({ id: 'edge', sites: { l: [GRIP[0], top + GRIP[1], end + GRIP[2]], r: [-GRIP[0], top + GRIP[1], end + GRIP[2]] } })
  const contacts: Contact[] = (['l', 'r'] as const).map((s) => ({ site: `grip_${s}`, kind: 'grip', target: { implement: palms.id, grip: s } }))
  const setup: Setup = {
    implements: [bench, palms],
    contacts,
    tempo,
    symmetric: true,
    rests: [{ implement: bench.id, regions: ['trunk', 'head', 'hand_l', 'hand_r'], tol: 15 }],
  }
  return { kind: 'dragon', tempo, setup, tilt0, bench, benchPose, top, shoulderZ, palms }
}

export function sampleDragon(skel: Skeleton, v: Dragon, c: number): Pose {
  const q = zeroQ(skel)
  body(skel, q, v, c)
  arms(skel, q, v.palms)
  return { q, implements: [v.benchPose, { id: v.palms.id, pos: [0, 0, 0], rot: qid() }], contacts: v.setup.contacts }
}

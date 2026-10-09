import { bodyCapsules } from '../../collide.ts'
import { fk } from '../../fk.ts'
import { ghd, GHD } from '../../implements/stations.ts'
import type { ImplementSpec } from '../../implements.ts'
import { DEG, lerp, qaxis, smoothstep, type V3 } from '../../math.ts'
import { setDofs, setScapula, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'

// GHD sit-up (817): seated on the glute-ham developer's pad facing the foot plate (+Z), the thighs along the pad, the
// knees soft and the ankles hooked between the rollers; the hips sit just past the pad's round nose. The trunk leans
// back from the hips to about parallel with the floor (slow eccentric), arms overhead in line with it, then sits up
// (quick concentric) with the spine curling and the arms swinging forward to reach towards the feet. The thighs and
// shins stay where the pad and rollers hold them. Research (motion-authoring): hip flexion from ~0 (trunk parallel)
// to ~90 deg plus trunk flexion at the top; the keyframes are author judgment.

/** deg, bottom (leaned back) -> top (sat up): pelvis tilt, lumbar and thoracic flexion, shoulder elevation in the
 * flexion plane, neck; knee flexion held */
export const GHD_SIT = { tilt: [-86, -4], lumbar: [-4, 16], thorax: [-2, 18], arms: [168, 92], neck: [-2, 16], knee: 48, ankle: 30 } as const
/** hip joints this far past the front of the pad's nose (m), the pad sinking under the thighs (m), the soft-tissue
 * allowance on the pad and rollers (mm) */
const HIP_PAST = 0.06
const PAD_SINK = 0.01
const REST = 22
/** roller axis this far up the shin from the ankle joint, plate face this far past the ankle joint, m */
const ROLLER_UP = 0.09
const PLATE_AHEAD = 0.12
/** rollers' surfaces this far apart, m: the lower shin's girth with the pads pressed a little */
const ROLLER_GAP = 0.15
/** the rollers' midline this far above the shin's axis (negative: below; the sloping shin's calf meets the lower roller further up the leg), m */
const ROLLER_RAISE = -0.015

export type GhdSit = { kind: 'ghd'; tempo: Tempo; setup: Setup; hip: V3; station: ImplementSpec; pose: ImplementPose }

function body(skel: Skeleton, q: Float64Array, hip: V3, c: number) {
  const tilt = lerp(GHD_SIT.tilt[0], GHD_SIT.tilt[1], c)
  // the arms swing ahead of the trunk on the way up
  const a = smoothstep(Math.min(1, c * 1.15))
  setDofs(skel, q, {
    'lumbar.flex': lerp(GHD_SIT.lumbar[0], GHD_SIT.lumbar[1], c),
    'thorax.flex': lerp(GHD_SIT.thorax[0], GHD_SIT.thorax[1], c),
    'neck.flex': lerp(GHD_SIT.neck[0], GHD_SIT.neck[1], c),
    'head.flex': 2,
    'clavicle_*.elev': 6,
    'clavicle_*.prot': lerp(0, 10, a),
    'shoulder_*.plane': 90,
    'shoulder_*.elev': lerp(GHD_SIT.arms[0], GHD_SIT.arms[1], a),
    'shoulder_*.rot': 0,
    'elbow_*.flex': 8,
    'forearm_*.pro': lerp(10, 0, a),
    // thighs level along the pad whatever the pelvis does
    'hip_*.flex': 90 + tilt,
    'hip_*.abd': 2,
    'knee_*.flex': GHD_SIT.knee,
    'ankle_*.df': GHD_SIT.ankle,
    'grip_*.close': 0,
  })
  for (const s of ['l', 'r'] as const) setScapula(skel, q, s)
  setPelvis(skel, q, hip, tilt)
}

export function ghdSitContext(skel: Skeleton, tempo: Tempo): GhdSit {
  const q = zeroQ(skel)
  const trial: V3 = [0, 1.0, 0]
  body(skel, q, trial, 1)
  const f = fk(skel, q)
  // pad top just under the thighs, the rollers round the ankles
  const thighLow = Math.min(...bodyCapsules(skel, f).filter((c) => c.region.startsWith('thigh_')).map((c) => Math.min(c.a[1], c.b[1]) - c.r))
  const lift = GHD.padTop - (thighLow + PAD_SINK)
  const hip: V3 = [0, trial[1] + lift, 0]
  const ankle = f.pos[skel.seg.foot_l], knee = f.pos[skel.seg.tibia_l]
  // the rollers clamp the lower shin a little above the ankle joint (clear of the heel)
  const up = ROLLER_UP / Math.hypot(knee[1] - ankle[1], knee[2] - ankle[2])
  const roll = { y: ankle[1] + (knee[1] - ankle[1]) * up + lift + ROLLER_RAISE, z: ankle[2] + (knee[2] - ankle[2]) * up }
  // the station turned to face the lifter: its +Z (plate to nose) runs towards -Z; plate face GHD-local z = 0
  const plateZ = ankle[2] + PLATE_AHEAD
  const reach = plateZ - (hip[2] + HIP_PAST)
  const station = ghd({ ankle: { z: plateZ - roll.z, y: roll.y }, reach, gap: ROLLER_GAP })
  const pose: ImplementPose = { id: station.id, pos: [0, 0, plateZ], rot: qaxis([0, 1, 0], 180 * DEG) }
  const setup: Setup = {
    implements: [station],
    contacts: [],
    tempo,
    symmetric: true,
    rests: [{ implement: station.id, regions: ['thigh_l', 'thigh_r', 'shank_l', 'shank_r', 'foot_l', 'foot_r', 'trunk'], tol: REST }],
  }
  return { kind: 'ghd', tempo, setup, hip, station, pose }
}

export function sampleGhdSit(skel: Skeleton, v: GhdSit, c: number): Pose {
  const q = zeroQ(skel)
  body(skel, q, v.hip, c)
  return { q, implements: [v.pose], contacts: v.setup.contacts }
}

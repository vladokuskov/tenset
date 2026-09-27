import { mirrorSpec, type JointSpec, type Pose } from './rig.ts'

type Joints = Record<string, JointSpec>

// Rest pose (MakeHuman): upper arms ~37 deg off vertical, elbows flexed ~46 deg with forearms forward.

function merge(...parts: Joints[]): Joints {
  const out: Joints = {}
  for (const p of parts) for (const [k, v] of Object.entries(p)) out[k] = { ...out[k], ...v }
  return out
}

/** left-side spec, mirrored onto the right */
function sym(left: Joints): Joints {
  const out: Joints = {}
  for (const [base, spec] of Object.entries(left)) {
    out[`${base}_L`] = spec
    out[`${base}_R`] = mirrorSpec(spec)
  }
  return out
}

/** elbow flexion in degrees (0 = straight) */
function elbow(flexion: number): Joints {
  return { lowerarm01: { flex: flexion } }
}

/** forearm rotation from the rest orientation, spread over both twist bones: + pronation, - supination */
function forearm(rotation: number): Joints {
  return { lowerarm01: { twist: rotation * 0.4 }, lowerarm02: { twist: rotation * 0.6 } }
}

/** curl in degrees per joint (knuckle, middle, tip); close pulls the spread fingers together */
function fingers(curl: number, thumb = curl * 0.5, close = 0.75): Joints {
  const out: Joints = {}
  for (const f of [2, 3, 4, 5]) {
    const k = 1 + (f - 2) * 0.12
    out[`finger${f}-1`] = { flex: curl * 0.7 * k, close }
    out[`finger${f}-2`] = { flex: curl * k }
    out[`finger${f}-3`] = { flex: curl * 0.6 * k }
  }
  out['finger1-2'] = { local: [thumb, 0, 0] }
  out['finger1-3'] = { local: [thumb, 0, 0] }
  return out
}

/** rest stance has feet ~40 cm apart: adduct the hips by `deg` and keep the soles flat */
function stance(deg: number): Joints {
  return { upperleg01: { rot: [0, 0, -deg] }, foot: { rot: [0, 0, deg] } }
}

function shoulderGirdle(elevation: number): Joints {
  return { clavicle: { rot: [0, 0, elevation * 0.5] }, shoulder01: { rot: [0, 0, elevation * 0.5] } }
}

export const poses = {
  rest: { joints: {} },
  relaxed: {
    joints: sym(merge(
      stance(4.5),
      { upperarm01: { aim: [0.3, -0.95, 0.03] } },
      elbow(12),
      forearm(0),
      fingers(14),
    )),
  },
  // BodyParts3D's anatomical position (arms at the sides, palms forward, legs straight); atlas registration and QA
  anatomical: {
    joints: sym(merge(
      { upperleg01: { aim: [-0.036, -0.999, -0.008] }, lowerleg01: { aim: [0.01, -1, -0.011] }, foot: { aim: [0.03, -0.45, 0.89] } },
      { upperarm01: { aim: [0.166, -0.985, -0.04] }, lowerarm01: { aim: [0.186, -0.958, 0.197] } },
      forearm(-82),
    )),
  },
  'arms-overhead': {
    joints: sym(merge(
      stance(4.5),
      shoulderGirdle(12),
      { upperarm01: { aim: [0.18, 1, 0.04] } },
      elbow(0),
      forearm(0),
      fingers(10),
    )),
  },
  'abduction-90': {
    joints: sym(merge(
      stance(4.5),
      shoulderGirdle(14),
      { upperarm01: { aim: [1, 0, 0] } },
      elbow(0),
      forearm(0),
      fingers(10),
    )),
  },
  pronation: {
    joints: sym(merge(
      stance(4.5),
      { upperarm01: { aim: [0.12, -1, -0.02] } },
      elbow(90),
      forearm(85),
      fingers(10),
    )),
  },
  supination: {
    joints: sym(merge(
      stance(4.5),
      { upperarm01: { aim: [0.12, -1, -0.02] } },
      elbow(90),
      forearm(-85),
      fingers(10),
    )),
  },
  'deep-squat': {
    joints: merge(
      {
        // pelvis tilts with the torso so the hip joint itself flexes less
        root: { rot: [26, 0, 0] },
        spine05: { rot: [6, 0, 0] },
        spine04: { rot: [4, 0, 0] },
        spine03: { rot: [2, 0, 0] },
        neck01: { rot: [-12, 0, 0] },
        head: { rot: [-14, 0, 0] },
      },
      sym(merge(
        { upperleg01: { rot: [-88, 18, 0] } },
        { lowerleg01: { local: [140, 0, 0] } },
        { foot: { aim: [0.22, -0.45, 0.87] } },
        { upperarm01: { aim: [0.12, -0.05, 1] } },
        elbow(4),
        forearm(0),
        fingers(12),
      )),
    ),
  },
  'dead-hang': {
    lift: 0.14,
    joints: merge(
      sym(merge(
        shoulderGirdle(20),
        { upperarm01: { aim: [0.3, 1, 0.06] } },
        elbow(0),
        forearm(90),
        fingers(70, 40),
        { upperleg01: { rot: [-8, 0, -6] } },
        { lowerleg01: { local: [14, 0, 0] } },
        { foot: { rot: [0, 0, 6], local: [25, 0, 0] } },
      )),
    ),
  },
  // exercise stills (FK only, dumbbells in both hands via props/HandProp)
  'db-curl-mid': {
    joints: sym(merge(
      stance(4.5),
      { upperarm01: { aim: [0.1, -1, 0.1], twist: 15 } },
      elbow(88),
      forearm(-80),
      fingers(78, 45),
    )),
  },
  'db-lateral-raise-top': {
    joints: merge(
      { root: { rot: [3, 0, 0] }, spine03: { rot: [2, 0, 0] }, neck01: { rot: [-3, 0, 0] } },
      sym(merge(
        stance(3),
        { lowerleg01: { local: [6, 0, 0] } },
        shoulderGirdle(6),
        { upperarm01: { aim: [1, -0.03, 0.15] } },
        elbow(16),
        forearm(0),
        fingers(78, 45),
      )),
    ),
  },
  'db-shoulder-press-bottom': {
    joints: merge(
      { root: { rot: [-10, 0, 0] }, spine04: { rot: [3, 0, 0] }, spine02: { rot: [2, 0, 0] }, neck01: { rot: [6, 0, 0] }, head: { rot: [2, 0, 0] } },
      sym(merge(
        { upperleg01: { rot: [-80, 10, 0] } },
        { lowerleg01: { local: [88, 0, 0] } },
        { foot: { aim: [0.12, -0.45, 0.88] } },
        shoulderGirdle(8),
        // external rotation mostly on the lower humerus, so the deltoid stays over the front of the shoulder
        { upperarm01: { aim: [0.84, -0.46, 0.3], twist: -18 }, upperarm02: { twist: -66 } },
        elbow(112),
        forearm(0),
        fingers(78, 45),
      )),
    ),
  },
} satisfies Record<string, Pose>

export type PoseName = keyof typeof poses

export const poseNames = Object.keys(poses) as PoseName[]

export function isPoseName(s: unknown): s is PoseName {
  return typeof s === 'string' && s in poses
}

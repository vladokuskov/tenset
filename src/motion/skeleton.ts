import { DEG, qaxis, qid, qmul, type Quat, type V3 } from './math.ts'

// Canonical skeleton, ISB-style joint naming. World and zero-pose frames: X = figure's left, Y = up, Z = forward.
// Zero pose: upright, arms hanging with straight elbows, forearms mid-position (thumbs forward), legs straight and
// vertical, feet flat and parallel. Every segment frame is world-aligned in the zero pose, so each DOF is a rotation
// about a fixed axis of its parent frame. Angles in degrees, flexion positive, left and right values mirror
// (the same value on both sides gives a symmetric pose). Axes below are for the left side and the midline;
// right-side axes are mirrored across the sagittal plane: (x, y, z) -> (x, -y, -z).

export type Side = 'l' | 'r'
export type Unit = 'deg' | 'm' | 'ratio'

type DofSpec = { key: string; axis: V3; min: number; max: number; unit?: Unit; note: string }

export type JointKind = 'root' | 'euler' | 'swing' | 'scalar'

type JointSpec = {
  name: string
  kind: JointKind
  dofs: DofSpec[]
  /** segments driven by this joint and the share of its rotation each takes (shares sum to 1) */
  targets: [string, number][]
}

const L: V3 = [1, 0, 0]
const U: V3 = [0, 1, 0]
const F: V3 = [0, 0, 1]
const nL: V3 = [-1, 0, 0]
const nU: V3 = [0, -1, 0]
const nF: V3 = [0, 0, -1]

const MIDLINE: JointSpec[] = [
  {
    name: 'pelvis',
    kind: 'root',
    dofs: [
      { key: 'tx', axis: L, min: -10, max: 10, unit: 'm', note: 'root position, metres (+ left)' },
      { key: 'ty', axis: U, min: -10, max: 10, unit: 'm', note: 'root height, metres' },
      { key: 'tz', axis: F, min: -10, max: 10, unit: 'm', note: 'root position, metres (+ forward)' },
      { key: 'rot', axis: U, min: -180, max: 180, note: 'yaw, + turns left; applied first' },
      { key: 'tilt', axis: L, min: -180, max: 180, note: '+ anterior tilt (top forward)' },
      { key: 'list', axis: F, min: -180, max: 180, note: '+ raises the left side' },
    ],
    targets: [['pelvis', 1]],
  },
  {
    name: 'lumbar',
    kind: 'euler',
    dofs: [
      { key: 'flex', axis: L, min: -30, max: 50, note: '+ flexion' },
      { key: 'bend', axis: nF, min: -25, max: 25, note: '+ bends to the left' },
      { key: 'rot', axis: U, min: -15, max: 15, note: '+ rotates to the left' },
    ],
    targets: [['lumbar1', 0.3], ['lumbar2', 0.35], ['lumbar3', 0.35]],
  },
  {
    name: 'thorax',
    kind: 'euler',
    dofs: [
      { key: 'flex', axis: L, min: -25, max: 40, note: '+ flexion' },
      { key: 'bend', axis: nF, min: -20, max: 20, note: '+ bends to the left' },
      { key: 'rot', axis: U, min: -35, max: 35, note: '+ rotates to the left' },
    ],
    targets: [['thorax1', 0.5], ['thorax2', 0.5]],
  },
  {
    name: 'neck',
    kind: 'euler',
    dofs: [
      { key: 'flex', axis: L, min: -50, max: 50, note: '+ flexion' },
      { key: 'bend', axis: nF, min: -35, max: 35, note: '+ bends to the left' },
      { key: 'rot', axis: U, min: -60, max: 60, note: '+ turns left' },
    ],
    targets: [['neck1', 0.4], ['neck2', 0.3], ['neck3', 0.3]],
  },
  {
    name: 'head',
    kind: 'euler',
    dofs: [
      { key: 'flex', axis: L, min: -30, max: 30, note: '+ chin down' },
      { key: 'bend', axis: nF, min: -15, max: 15, note: '+ tilts to the left' },
      { key: 'rot', axis: U, min: -20, max: 20, note: '+ turns left' },
    ],
    targets: [['head', 1]],
  },
]

function limb(s: Side): JointSpec[] {
  return [
    {
      name: `clavicle_${s}`,
      kind: 'euler',
      dofs: [
        { key: 'prot', axis: nU, min: -25, max: 25, note: '+ protraction, - retraction' },
        { key: 'elev', axis: F, min: -10, max: 40, note: '+ elevation (shrug), - depression' },
      ],
      targets: [[`clavicle_${s}`, 0.5], [`scapula_${s}`, 0.5]],
    },
    {
      // humerothoracic swing-twist: swing by `elev` towards the plane direction, then axial rotation
      name: `shoulder_${s}`,
      kind: 'swing',
      dofs: [
        { key: 'plane', axis: nU, min: -180, max: 180, note: 'plane of elevation: 0 abduction, 90 flexion, <0 behind, >90 across (unbounded: meaningless near 0 elevation)' },
        { key: 'elev', axis: F, min: 0, max: 180, note: 'elevation from hanging' },
        { key: 'rot', axis: nU, min: -110, max: 80, note: '+ internal rotation, 0 = twist-free swing; trained lifters reach ~100-110 external' },
      ],
      targets: [[`humerus_${s}`, 1]],
    },
    {
      name: `elbow_${s}`,
      kind: 'euler',
      dofs: [{ key: 'flex', axis: nL, min: 0, max: 150, note: '+ flexion, 0 straight' }],
      targets: [[`forearm_${s}`, 1]],
    },
    {
      name: `forearm_${s}`,
      kind: 'euler',
      dofs: [{ key: 'pro', axis: nU, min: -85, max: 85, note: '+ pronation, - supination, 0 thumb forward' }],
      targets: [[`forearm_${s}`, 1]],
    },
    {
      name: `wrist_${s}`,
      kind: 'euler',
      dofs: [
        { key: 'flex', axis: nF, min: -70, max: 75, note: '+ flexion (palm side), - extension' },
        { key: 'dev', axis: nL, min: -35, max: 20, note: '+ radial, - ulnar deviation' },
      ],
      targets: [[`hand_${s}`, 1]],
    },
    {
      name: `hip_${s}`,
      kind: 'euler',
      dofs: [
        { key: 'flex', axis: nL, min: -30, max: 135, note: '+ flexion (deep squat needs ~125-135)' },
        { key: 'abd', axis: F, min: -30, max: 50, note: '+ abduction, - adduction' },
        { key: 'rot', axis: nU, min: -45, max: 45, note: '+ internal, - external rotation' },
      ],
      targets: [[`femur_${s}`, 1]],
    },
    {
      name: `knee_${s}`,
      kind: 'euler',
      dofs: [{ key: 'flex', axis: L, min: 0, max: 150, note: '+ flexion, 0 straight' }],
      targets: [[`tibia_${s}`, 1]],
    },
    {
      name: `ankle_${s}`,
      kind: 'euler',
      dofs: [
        { key: 'df', axis: nL, min: -50, max: 40, note: '+ dorsiflexion (weight-bearing ~35-45), - plantarflexion' },
        { key: 'inv', axis: nF, min: -20, max: 30, note: '+ inversion, - eversion' },
      ],
      targets: [[`foot_${s}`, 1]],
    },
    {
      name: `toe_${s}`,
      kind: 'euler',
      dofs: [{ key: 'flex', axis: L, min: -60, max: 40, note: '+ flexion (curl), - extension' }],
      targets: [[`toes_${s}`, 1]],
    },
    {
      name: `grip_${s}`,
      kind: 'scalar',
      dofs: [{ key: 'close', axis: L, min: 0, max: 1, unit: 'ratio', note: 'finger closure, 0 relaxed, 1 closed on a handle (renderer hint)' }],
      targets: [],
    },
  ]
}

const mirrorAxis = (a: V3): V3 => [a[0], -a[1], -a[2]]

function mirrorJoints(js: JointSpec[]): JointSpec[] {
  return js.map((j) => ({
    ...j,
    name: j.name.replace(/_l$/, '_r'),
    dofs: j.dofs.map((d) => ({ ...d, axis: mirrorAxis(d.axis) })),
    targets: j.targets.map(([s, w]) => [s.replace(/_l$/, '_r'), w] as [string, number]),
  }))
}

export const JOINTS: JointSpec[] = [...MIDLINE, ...limb('l'), ...mirrorJoints(limb('l'))]

export type SegmentSpec = {
  name: string
  parent: string | null
  /** orientation parent when it differs from the position parent (humerus: thorax, humerothoracic angles) */
  orient?: string
  /** MPFB2 default_no_toes bones rigidly attached to this segment; twist = share of the axial twist a proximal twist bone takes */
  bones: { name: string; twist?: number }[]
}

function limbSegments(s: Side): SegmentSpec[] {
  const B = s.toUpperCase()
  return [
    { name: `clavicle_${s}`, parent: 'thorax2', bones: [{ name: `clavicle_${B}` }] },
    { name: `scapula_${s}`, parent: `clavicle_${s}`, bones: [{ name: `shoulder01_${B}` }] },
    { name: `humerus_${s}`, parent: `scapula_${s}`, orient: 'thorax2', bones: [{ name: `upperarm01_${B}`, twist: 0.5 }, { name: `upperarm02_${B}` }] },
    { name: `forearm_${s}`, parent: `humerus_${s}`, bones: [{ name: `lowerarm01_${B}`, twist: 0.4 }, { name: `lowerarm02_${B}` }] },
    { name: `hand_${s}`, parent: `forearm_${s}`, bones: [{ name: `wrist_${B}` }] },
    { name: `femur_${s}`, parent: 'pelvis', bones: [{ name: `upperleg01_${B}`, twist: 0.5 }, { name: `upperleg02_${B}` }] },
    { name: `tibia_${s}`, parent: `femur_${s}`, bones: [{ name: `lowerleg01_${B}` }, { name: `lowerleg02_${B}` }] },
    { name: `foot_${s}`, parent: `tibia_${s}`, bones: [{ name: `foot_${B}` }] },
    { name: `toes_${s}`, parent: `foot_${s}`, bones: [{ name: `toe1-1_${B}` }] },
  ]
}

export const SEGMENTS: SegmentSpec[] = [
  { name: 'pelvis', parent: null, bones: [{ name: 'root' }, { name: 'pelvis_L' }, { name: 'pelvis_R' }] },
  { name: 'lumbar1', parent: 'pelvis', bones: [{ name: 'spine05' }] },
  { name: 'lumbar2', parent: 'lumbar1', bones: [{ name: 'spine04' }] },
  { name: 'lumbar3', parent: 'lumbar2', bones: [{ name: 'spine03' }] },
  { name: 'thorax1', parent: 'lumbar3', bones: [{ name: 'spine02' }] },
  { name: 'thorax2', parent: 'thorax1', bones: [{ name: 'spine01' }] },
  { name: 'neck1', parent: 'thorax2', bones: [{ name: 'neck01' }] },
  { name: 'neck2', parent: 'neck1', bones: [{ name: 'neck02' }] },
  { name: 'neck3', parent: 'neck2', bones: [{ name: 'neck03' }] },
  { name: 'head', parent: 'neck3', bones: [{ name: 'head' }] },
  ...limbSegments('l'),
  ...limbSegments('r'),
]

/** Segment mass fractions of body mass (de Leva 1996, male), split evenly where we have finer segments. */
export const MASS_FRACTION: Record<string, number> = {
  pelvis: 0.1117,
  lumbar1: 0.0544, lumbar2: 0.0544, lumbar3: 0.0545,
  thorax1: 0.0798, thorax2: 0.0798,
  neck1: 0.0081, neck2: 0.0081, neck3: 0.0081, head: 0.0451,
  clavicle_l: 0, scapula_l: 0, humerus_l: 0.0271, forearm_l: 0.0162, hand_l: 0.0061,
  femur_l: 0.1416, tibia_l: 0.0433, foot_l: 0.0107, toes_l: 0.003,
  clavicle_r: 0, scapula_r: 0, humerus_r: 0.0271, forearm_r: 0.0162, hand_r: 0.0061,
  femur_r: 0.1416, tibia_r: 0.0433, foot_r: 0.0107, toes_r: 0.003,
}

/** COM position along the segment from its origin towards its distal joint (de Leva 1996) */
export const COM_RATIO: Record<string, number> = {
  humerus: 0.577, forearm: 0.457, hand: 0.79, femur: 0.41, tibia: 0.446, foot: 0.44, toes: 0.5,
}

export const BODY_MASS = 80

// ---------- data written by pipeline/motion/extract-skeleton.ts ----------

export type SiteData = { segment: string; local: V3; axis?: V3; normal?: V3 }

export type SkeletonData = {
  version: 1
  source: { model: string; sha256: string; rig: string }
  units: 'm'
  axes: string
  height: number
  /** distance between the glenohumeral joint centres; gripWidth params are multiples of this */
  shoulderWidth: number
  hipWidth: number
  /** pelvis origin height with both soles on the floor in the zero pose */
  standingHeight: number
  segments: Record<string, { origin: V3; offset: V3; length: number; com: V3; mass: number }>
  bones: Record<string, {
    parent: string | null
    segment: string | null
    /** bind local translation and rotation (glTF node TRS) */
    t: V3
    bindLocal: Quat
    bindWorld: Quat
    /** bone world rotation in the canonical zero pose */
    zeroWorld: Quat
    head: V3
  }>
  sites: Record<string, SiteData>
}

// ---------- runtime skeleton ----------

export type Dof = {
  index: number
  name: string
  joint: string
  key: string
  axis: V3
  unit: Unit
  min: number
  max: number
  note: string
}

export type JointRt = { name: string; kind: JointKind; dofs: number[]; targets: { segment: number; weight: number }[] }

export type SegmentRt = {
  index: number
  name: string
  parent: number
  orient: number
  offset: V3
  length: number
  /** joints driving this segment, in composition order */
  joints: { joint: number; weight: number }[]
  bones: { name: string; twist?: number }[]
  com: V3
  mass: number
}

export type Skeleton = {
  data: SkeletonData
  dofs: Dof[]
  dof: Record<string, number>
  joints: JointRt[]
  segments: SegmentRt[]
  seg: Record<string, number>
}

export const DOF_NAMES: string[] = JOINTS.flatMap((j) => j.dofs.map((d) => `${j.name}.${d.key}`))

export function createSkeleton(data: SkeletonData): Skeleton {
  const dofs: Dof[] = []
  const dof: Record<string, number> = {}
  const joints: JointRt[] = []
  const seg: Record<string, number> = {}
  SEGMENTS.forEach((s, i) => (seg[s.name] = i))
  for (const j of JOINTS) {
    const ids: number[] = []
    for (const d of j.dofs) {
      const name = `${j.name}.${d.key}`
      dof[name] = dofs.length
      ids.push(dofs.length)
      dofs.push({ index: dofs.length, name, joint: j.name, key: d.key, axis: d.axis, unit: d.unit ?? 'deg', min: d.min, max: d.max, note: d.note })
    }
    joints.push({ name: j.name, kind: j.kind, dofs: ids, targets: j.targets.map(([s, w]) => ({ segment: seg[s], weight: w })) })
  }
  const segments: SegmentRt[] = SEGMENTS.map((s, i) => {
    const d = data.segments[s.name]
    if (!d) throw new Error(`skeleton.json: missing segment ${s.name}`)
    return {
      index: i,
      name: s.name,
      parent: s.parent ? seg[s.parent] : -1,
      orient: s.orient ? seg[s.orient] : s.parent ? seg[s.parent] : -1,
      offset: d.offset,
      length: d.length,
      joints: [],
      bones: s.bones,
      com: d.com,
      mass: d.mass,
    }
  })
  joints.forEach((j, ji) => {
    for (const t of j.targets) segments[t.segment].joints.push({ joint: ji, weight: t.weight })
  })
  return { data, dofs, dof, joints, segments, seg }
}

// ---------- poses ----------

export type ImplementPose = { id: string; pos: V3; rot: Quat }

export type Contact = {
  /** skeleton site name, e.g. heel_l, grip_r */
  site: string
  kind: 'planted' | 'grip' | 'support'
  /** fixed world point, or an implement grip that moves with the implement */
  target: { world: V3 } | { implement: string; grip: string }
}

/**
 * One frame. q holds every DOF in skeleton order (degrees; pelvis.tx/ty/tz in metres; grip in 0..1):
 * the root transform is the pelvis.* DOFs.
 */
export type Pose = { q: Float64Array; implements: ImplementPose[]; contacts: Contact[] }

export function zeroQ(skel: Skeleton): Float64Array {
  const q = new Float64Array(skel.dofs.length)
  q[skel.dof['pelvis.ty']] = skel.data.standingHeight
  return q
}

export function getDof(skel: Skeleton, q: Float64Array, name: string) {
  const i = skel.dof[name]
  if (i === undefined) throw new Error(`unknown dof ${name}`)
  return q[i]
}

export function setDof(skel: Skeleton, q: Float64Array, name: string, v: number) {
  const i = skel.dof[name]
  if (i === undefined) throw new Error(`unknown dof ${name}`)
  q[i] = v
}

/** set many DOFs; keys ending in `_*` set both sides (e.g. 'knee_*.flex') */
export function setDofs(skel: Skeleton, q: Float64Array, values: Record<string, number>) {
  for (const [k, v] of Object.entries(values)) {
    if (k.includes('_*')) {
      setDof(skel, q, k.replace('_*', '_l'), v)
      setDof(skel, q, k.replace('_*', '_r'), v)
    } else setDof(skel, q, k, v)
  }
}

/** DOFs whose sign flips when a pose is mirrored across the sagittal plane */
const MIRROR_NEGATE = new Set(['pelvis.tx', 'pelvis.rot', 'pelvis.list', 'lumbar.bend', 'lumbar.rot', 'thorax.bend', 'thorax.rot', 'neck.bend', 'neck.rot', 'head.bend', 'head.rot'])

export function mirrorQ(skel: Skeleton, q: Float64Array): Float64Array {
  const out = new Float64Array(q.length)
  for (const d of skel.dofs) {
    const other = /_l\./.test(d.name) ? d.name.replace('_l.', '_r.') : /_r\./.test(d.name) ? d.name.replace('_r.', '_l.') : d.name
    const v = q[skel.dof[other]]
    out[d.index] = MIRROR_NEGATE.has(d.name) ? -v : v
  }
  return out
}

export function pairedDofs(skel: Skeleton): [number, number][] {
  return skel.dofs.filter((d) => /_l\./.test(d.name)).map((d) => [d.index, skel.dof[d.name.replace('_l.', '_r.')]])
}

// ---------- joint rotations ----------

const ax = (a: V3, deg: number) => qaxis(a, deg * DEG)

/** swing axis for the shoulder: perpendicular to hanging and to the plane direction, mirrored for the right */
export function swingAxis(planeDeg: number, side: Side): V3 {
  const p = planeDeg * DEG
  return side === 'l' ? [-Math.sin(p), 0, Math.cos(p)] : [-Math.sin(p), 0, -Math.cos(p)]
}

/** local rotation of a joint from its DOF values (intrinsic, in DOF order) */
export function jointRotation(skel: Skeleton, j: JointRt, q: ArrayLike<number>): Quat {
  const d = skel.dofs
  if (j.kind === 'swing') {
    const [ip, ie, ir] = j.dofs
    const side: Side = j.name.endsWith('_r') ? 'r' : 'l'
    return qmul(ax(swingAxis(q[ip], side), q[ie]), ax(d[ir].axis, q[ir]))
  }
  if (j.kind === 'scalar') return qid()
  const ids = j.kind === 'root' ? j.dofs.slice(3) : j.dofs
  let r = qid()
  for (const i of ids) r = qmul(r, ax(d[i].axis, q[i]))
  return r
}

// ---------- scapulohumeral rhythm ----------

/**
 * Clavicle elevation/protraction that accompany humerothoracic elevation. Heuristic: no girdle motion below
 * 30 deg, then roughly 1 deg of clavicle elevation per 7 deg of arm elevation, protraction growing with
 * forward planes. Author judgment, to be fitted from video.
 */
export function shoulderRhythm(elevDeg: number, planeDeg: number): { elev: number; prot: number } {
  const e = Math.max(0, elevDeg - 30)
  const fwd = Math.sin(Math.max(-30, Math.min(120, planeDeg)) * DEG)
  return { elev: e * 0.14, prot: e * 0.06 * fwd }
}

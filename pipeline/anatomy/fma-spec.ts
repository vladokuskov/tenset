// Hand-authored mapping from our taxonomy to BodyParts3D concept names (right side).
// build-fma-map.ts resolves these against isa_element_parts.txt into fma-map.json.

type Line = [[number, number], [number, number]]
// Coordinates are body millimetres: lateral distance from the midline (mirrored per side) and height z.
export type Clip = { zMin?: number; zMax?: number; above?: Line; below?: Line }
export type ViewClip = Partial<Record<'F' | 'B', Clip>>
export type PartSpec = {
  name: string
  deep?: string
  clip?: ViewClip
  // Pixels where the mesh is thinner than this along the view axis are aponeurosis, drawn as neutral.
  maxThicknessMm?: number
  // Where this part's projection overlaps these regions, it wins regardless of depth (used where
  // BodyParts3D meshes overlap instead of interdigitating).
  overrides?: string[]
}
export type RegionSpec = {
  id: string
  kind: 'head' | 'untracked'
  parts: PartSpec[]
  views?: ('F' | 'B')[] // defaults to the taxonomy view flag
  clip?: ViewClip
}

const WRIST = { F: { zMin: 822 }, B: { zMin: 822 } }
const ANKLE = { F: { zMin: 75 }, B: { zMin: 75 } }
// Boundary between pars transversa and pars ascendens, roughly T4 to the root of the scapular spine.
// BodyParts3D puts the T1-T3 fibres in its ascending part, so we re-split it here.
const TRAP_SPLIT: Line = [[0, 1282], [100, 1302]]

export const SKIN = 'skin'

export const REGIONS: RegionSpec[] = [
  { id: 'pec_clavicular', kind: 'head', parts: [{ name: 'clavicular part of right pectoralis major' }] },
  {
    id: 'pec_sternal', kind: 'head',
    parts: [{ name: 'sternocostal part of right pectoralis major' }, { name: 'abdominal part of right pectoralis major' }],
  },
  { id: 'delt_anterior', kind: 'head', parts: [{ name: 'clavicular part of right deltoid' }] },
  { id: 'delt_lateral', kind: 'head', parts: [{ name: 'acromial part of right deltoid' }] },
  { id: 'delt_posterior', kind: 'head', parts: [{ name: 'spinal part of right deltoid' }] },
  {
    id: 'biceps_brachii', kind: 'head',
    parts: [{ name: 'long head of right biceps brachii' }, { name: 'short head of right biceps brachii' }],
  },
  { id: 'brachialis', kind: 'head', parts: [{ name: 'right brachialis' }] },
  { id: 'brachioradialis', kind: 'head', clip: WRIST, parts: [{ name: 'right brachioradialis' }] },
  {
    id: 'wrist_flexors', kind: 'head', clip: WRIST,
    parts: [
      { name: 'right flexor carpi radialis' },
      { name: 'right palmaris longus' },
      { name: 'humeral head of right flexor carpi ulnaris' },
      { name: 'ulnar head of right flexor carpi ulnaris' },
      { name: 'right flexor digitorum superficialis' },
      { name: 'humeral head of right pronator teres' },
      { name: 'ulnar head of right pronator teres' },
    ],
  },
  {
    id: 'wrist_extensors', kind: 'head', clip: WRIST,
    parts: [
      { name: 'right extensor carpi radialis longus' },
      { name: 'right extensor carpi radialis brevis' },
      { name: 'right extensor digitorum' },
      { name: 'right extensor digiti minimi' },
      { name: 'right extensor carpi ulnaris' },
      { name: 'right abductor pollicis longus' },
      { name: 'right extensor pollicis brevis' },
    ],
  },
  { id: 'triceps_long', kind: 'head', parts: [{ name: 'long head of right triceps brachii' }] },
  {
    id: 'triceps_lateral', kind: 'head',
    // The medial head peeks out on both sides above the elbow; left neutral so it doesn't read as the lateral head.
    parts: [{ name: 'lateral head of right triceps brachii' }],
  },
  { id: 'trap_upper', kind: 'head', parts: [{ name: 'descending part of right trapezius' }] },
  {
    id: 'trap_middle', kind: 'head',
    parts: [
      { name: 'transverse part of right trapezius' },
      { name: 'ascending part of right trapezius', clip: { B: { above: TRAP_SPLIT }, F: { above: TRAP_SPLIT } } },
      { name: 'right rhomboid major', deep: 'rhomboids' },
      { name: 'right rhomboid minor', deep: 'rhomboids' },
    ],
  },
  {
    id: 'trap_lower', kind: 'head',
    parts: [{ name: 'ascending part of right trapezius', clip: { B: { below: TRAP_SPLIT }, F: { below: TRAP_SPLIT } } }],
  },
  { id: 'latissimus_dorsi', kind: 'head', parts: [] },
  { id: 'teres_major', kind: 'head', parts: [{ name: 'right teres major' }] },
  {
    id: 'infraspinatus', kind: 'head',
    parts: [
      { name: 'right infraspinatus muscle' },
      { name: 'right teres minor', deep: 'teres_minor' },
      { name: 'right supraspinatus', deep: 'supraspinatus' },
    ],
  },
  { id: 'serratus_anterior', kind: 'head', parts: [{ name: 'right serratus anterior', overrides: ['external_oblique'] }] },
  { id: 'rectus_abdominis', kind: 'head', parts: [] },
  { id: 'external_oblique', kind: 'head', parts: [{ name: 'right external oblique', maxThicknessMm: 4 }] },
  {
    // Lats (not in BodyParts3D) cover the thoracic part; show the column rising toward the spine.
    id: 'erector_spinae', kind: 'head', clip: { B: { below: [[0, 1165], [70, 1085]] } },
    parts: [
      { name: 'right iliocostalis lumborum' },
      { name: 'right iliocostalis thoracis' },
      { name: 'right longissimus thoracis' },
      { name: 'right spinalis thoracis' },
    ],
  },
  { id: 'gluteus_maximus', kind: 'head', parts: [{ name: 'right gluteus maximus' }] },
  {
    id: 'gluteus_medius', kind: 'head',
    parts: [{ name: 'right gluteus medius' }, { name: 'right gluteus minimus', deep: 'gluteus_minimus' }],
  },
  { id: 'tfl', kind: 'head', parts: [{ name: 'right tensor fasciae latae' }] },
  {
    // Only the part below the inguinal ligament shows; the abdominal wall hides the rest.
    id: 'iliopsoas', kind: 'head', clip: { F: { below: [[25, 812], [125, 915]] } },
    parts: [{ name: 'right psoas major' }, { name: 'right iliacus' }],
  },
  {
    // BodyParts3D includes the patellar ligament in rectus femoris.
    id: 'rectus_femoris', kind: 'head', clip: { F: { zMin: 398 }, B: { zMin: 398 } },
    parts: [{ name: 'right rectus femoris' }, { name: 'right vastus intermedius', deep: 'vastus_intermedius' }],
  },
  { id: 'vastus_lateralis', kind: 'head', parts: [{ name: 'right vastus lateralis' }] },
  { id: 'vastus_medialis', kind: 'head', parts: [{ name: 'right vastus medialis' }] },
  {
    id: 'adductor_longus', kind: 'head',
    parts: [
      { name: 'right adductor longus' },
      { name: 'right adductor brevis' },
      { name: 'right pectineus' },
      { name: 'right gracilis' },
    ],
  },
  {
    id: 'adductor_magnus', kind: 'head',
    parts: [{ name: 'right adductor magnus' }, { name: 'right adductor minimus' }],
  },
  {
    id: 'biceps_femoris_long', kind: 'head',
    parts: [{ name: 'long head of right biceps femoris' }, { name: 'short head of right biceps femoris', deep: 'biceps_femoris_short' }],
  },
  { id: 'semitendinosus', kind: 'head', parts: [{ name: 'right semitendinosus' }] },
  { id: 'semimembranosus', kind: 'head', parts: [{ name: 'right semimembranosus' }] },
  { id: 'gastroc_medial', kind: 'head', parts: [{ name: 'medial head of right gastrocnemius' }] },
  { id: 'gastroc_lateral', kind: 'head', parts: [{ name: 'lateral head of right gastrocnemius' }] },
  { id: 'soleus', kind: 'head', clip: ANKLE, parts: [{ name: 'right soleus' }] },
  { id: 'tibialis_anterior', kind: 'head', clip: ANKLE, parts: [{ name: 'right tibialis anterior' }] },
  { id: 'sternocleidomastoid', kind: 'untracked', parts: [{ name: 'right sternocleidomastoid' }] },
  { id: 'sartorius', kind: 'untracked', parts: [{ name: 'right sartorius' }] },
  {
    id: 'fibularis', kind: 'untracked', clip: ANKLE,
    parts: [{ name: 'right fibularis longus' }, { name: 'right fibularis brevis' }],
  },
]

// Every element of these concepts (minus region parts and EXCLUDE) is rendered as
// neutral skin into the depth buffer, so it hides whatever lies behind it.
export const OCCLUDER_CONCEPTS = ['bone organ', 'cartilage organ', 'muscle organ', 'head of muscle organ', 'zone of muscle organ']
// Thin superficial sheets that would wrongly cover the pecs and neck.
// Serratus posterior sits under the (missing) lats and would punch holes in the lower back.
export const OCCLUDER_EXCLUDE = [
  'right platysma', 'left platysma',
  'right serratus posterior inferior', 'left serratus posterior inferior',
  'right serratus posterior superior', 'left serratus posterior superior',
]

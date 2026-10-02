import { z } from 'zod'

// Set before any schema is used: otherwise zod probes `new Function` once, which a strict CSP reports.
// Lives here because data modules parse at import time, possibly in a chunk that runs before main.tsx.
z.config({ jitless: true })

// Shared data contracts. Integrity rules that need cross-file context
// (ids exist in taxonomy, alternatives share a pattern, ...) live in data tests.

export const View = z.enum(['F', 'B', 'FB'])
export const Role = z.enum(['primary', 'secondary'])
export const DayIndex = z.number().int().min(0).max(6) // 0 = Monday

export const BandEdges = z.tuple([z.number(), z.number(), z.number(), z.number()])

export const Group = z.object({
  id: z.string(),
  name: z.string(),
  area: z.enum(['upper', 'core', 'lower']),
  banded: z.boolean(),
  optional: z.boolean(),
  bandEdges: BandEdges.optional(),
  bandSources: z.array(z.string()).optional(),
})

export const Head = z.object({
  id: z.string(),
  group: z.string(),
  name: z.string(),
  ta: z.string(),
  view: View,
})

export const DeepHead = z.object({
  id: z.string(),
  group: z.string(),
  name: z.string(),
  ta: z.string(),
  parent: z.string().nullable(),
})

export const Taxonomy = z.object({
  version: z.number(),
  bandEdgesDefault: BandEdges,
  bandSources: z.array(z.string()),
  groups: z.array(Group),
  heads: z.array(Head),
  deepHeads: z.array(DeepHead),
  untracked: z.array(z.object({ id: z.string(), name: z.string(), ta: z.string(), view: View })),
})

export const Pattern = z.enum([
  'horizontal_push', 'incline_push', 'vertical_push', 'dip',
  'horizontal_pull', 'vertical_pull',
  'squat', 'lunge', 'hinge', 'hip_extension',
  'knee_extension', 'knee_flexion',
  'elbow_flexion', 'elbow_extension',
  'shoulder_abduction', 'shoulder_flexion', 'shoulder_horizontal_abduction', 'shoulder_horizontal_adduction',
  'shoulder_external_rotation', 'scapular_elevation', 'scapular_upward_rotation',
  'plantarflexion', 'dorsiflexion', 'wrist_flexion', 'wrist_extension',
  'hip_abduction', 'hip_adduction', 'hip_flexion',
  'spinal_extension', 'spinal_flexion',
  'anti_extension', 'anti_lateral_flexion', 'anti_rotation', 'rotation',
])

export const MediaStatus = z.enum(['card', 'still', 'loop'])
export const QaStatus = z.enum(['pending', 'approved', 'rejected'])

export const Exercise = z.object({
  id: z.number().int().min(1).max(65535),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(2),
  aliases: z.array(z.string()),
  family: z.string(),
  equipment: z.array(z.string()), // AND: all items are needed; [] means bodyweight
  pattern: Pattern,
  mechanic: z.enum(['compound', 'isolation']),
  laterality: z.enum(['bilateral', 'unilateral', 'alternating']),
  level: z.number().int().min(1).max(3),
  unit: z.enum(['reps', 'seconds']),
  defaults: z.object({
    sets: z.number().int().min(1).max(10),
    reps: z.string(),
    strengthReps: z.string().optional(),
  }),
  groups: z.record(z.string(), Role), // drives bands: primary 1.0, secondary 0.5
  heads: z.record(z.string(), z.number().min(0).max(1)).optional(), // emphasis inside listed groups
  stabilizers: z.array(z.string()),
  alternatives: z.array(z.number().int()),
  media: z.object({
    status: MediaStatus,
    template: z.string().nullable(),
    params: z.record(z.string(), z.unknown()),
    mapView: z.enum(['F', 'B']),
  }),
  cues: z.array(z.string()).min(3).max(5),
  basis: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
  status: z.enum(['active', 'retired']),
  replacedBy: z.number().int().nullable(),
  qa: z.object({ data: QaStatus, motion: QaStatus, note: z.string().optional() }),
})

export const SplitSlot = z.object({
  pattern: Pattern,
  group: z.string(),
  sets: z.number().int().min(1).max(10),
  reps: z.string().optional(),
  options: z.array(z.number().int()).min(1), // ranked; first one the user's equipment allows wins
})

export const SplitTemplate = z.object({
  id: z.string(),
  name: z.string(),
  level: z.number().int().min(1).max(3),
  daysPerWeek: z.number().int().min(1).max(7),
  description: z.string(),
  defaultDays: z.array(DayIndex),
  sessions: z.array(z.object({ label: z.string(), slots: z.array(SplitSlot).min(1) })),
})

// Translations (data/i18n/<locale>/), keyed by the ids of the source records

export const LabelMap = z.record(z.string(), z.string().min(1))

export const ExerciseText = z.object({
  name: z.string().min(2),
  aliases: z.array(z.string()),
  cues: z.array(z.string()).min(3).max(5),
})

export const ExerciseTextMap = z.record(z.string().regex(/^\d+$/), ExerciseText)

export const TaxonomyText = z.object({ groups: LabelMap, heads: LabelMap, deepHeads: LabelMap, untracked: LabelMap })

export const EquipmentText = z.object({ groups: LabelMap, equipment: LabelMap, presets: LabelMap })

export const SplitText = z.record(
  z.string(),
  z.object({ name: z.string().min(1), description: z.string().min(1), sessions: z.array(z.string().min(1)) }),
)

// Persisted user state

export const CustomExerciseId = z.string().regex(/^c([1-9]|[1-5][0-9]|6[0-3])$/)
export const ExerciseRef = z.union([z.number().int().min(1).max(65535), CustomExerciseId])

export const Entry = z.object({
  id: z.string(),
  exerciseId: ExerciseRef,
  sets: z.number().int().min(1).max(20),
  reps: z.string().optional(),
  restSec: z.number().int().min(0).max(600).multipleOf(15).optional(),
  rir: z.number().int().min(0).max(5).optional(),
  /** Superset: paired with the entry above. Pairs only; program ops keep this consistent. */
  withPrev: z.literal(true).optional(),
})

export const Day = z.object({
  kind: z.enum(['rest', 'train']),
  label: z.string().max(24).optional(),
  note: z.string().max(80).optional(),
  entries: z.array(Entry),
})

export const CustomExercise = z.object({
  id: CustomExerciseId,
  name: z.string().min(1).max(40),
  equipment: z.array(z.string()),
  laterality: z.enum(['bilateral', 'unilateral', 'alternating']),
  groups: z.record(z.string(), Role),
})

export const Program = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
  templateId: z.string().optional(),
  days: z.array(Day).length(7),
  custom: z.array(CustomExercise).max(30),
})

export const Goal = z.enum(['hypertrophy', 'strength', 'general'])
export const CountingMode = z.enum(['fractional', 'primary'])

export const Locale = z.enum(['en', 'uk'])

export const TargetMode = z.enum(['normal', 'more', 'less', 'skip', 'custom'])
export const TargetPref = z.union([
  z.object({ mode: z.enum(['more', 'less', 'skip']) }),
  z.object({ mode: z.literal('custom'), min: z.number().int().min(1).max(59), max: z.number().int().min(2).max(60) }),
])

export const Prefs = z.object({
  /** Missing in prefs saved before languages existed; the store fills it from the browser. */
  locale: Locale.optional(),
  goal: Goal,
  equipment: z.array(z.string()),
  countingMode: CountingMode,
  weekStart: DayIndex,
  overrides: z.record(z.string(), z.record(z.string(), z.enum(['primary', 'secondary', 'none']))),
  /** Per-group personal range; a missing key means the cited range. */
  targets: z.record(z.string(), TargetPref).optional(),
})

export type Taxonomy = z.infer<typeof Taxonomy>
export type Group = z.infer<typeof Group>
export type Head = z.infer<typeof Head>
export type DeepHead = z.infer<typeof DeepHead>
export type Pattern = z.infer<typeof Pattern>
export type Exercise = z.infer<typeof Exercise>
export type SplitTemplate = z.infer<typeof SplitTemplate>
export type SplitSlot = z.infer<typeof SplitSlot>
export type Entry = z.infer<typeof Entry>
export type Day = z.infer<typeof Day>
export type CustomExercise = z.infer<typeof CustomExercise>
export type Program = z.infer<typeof Program>
export type ExerciseText = z.infer<typeof ExerciseText>
export type TaxonomyText = z.infer<typeof TaxonomyText>
export type EquipmentText = z.infer<typeof EquipmentText>
export type SplitText = z.infer<typeof SplitText>
export type Prefs = z.infer<typeof Prefs>
export type TargetPref = z.infer<typeof TargetPref>
export type TargetMode = z.infer<typeof TargetMode>
export type Role = z.infer<typeof Role>
export type ExerciseRef = z.infer<typeof ExerciseRef>

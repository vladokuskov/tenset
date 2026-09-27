// Small hand-made records for unit tests. Independent of data/exercises.
import { sequentialIds } from './ids.ts'
import type { Catalog } from './resolve.ts'
import { Exercise, type ExerciseRef, type Program, type SplitTemplate } from './schema.ts'

type ExercisePatch = Partial<Exercise> & Pick<Exercise, 'groups'>

export function fixtureExercise(id: number, patch: ExercisePatch): Exercise {
  return Exercise.parse({
    id,
    slug: `fixture-${id}`,
    name: `Fixture ${id}`,
    aliases: [],
    family: 'fixture',
    equipment: [],
    pattern: 'horizontal_push',
    mechanic: 'compound',
    laterality: 'bilateral',
    level: 1,
    unit: 'reps',
    defaults: { sets: 3, reps: '8-12' },
    stabilizers: [],
    alternatives: [],
    media: { status: 'card', template: null, params: {}, mapView: 'F' },
    cues: ['One', 'Two', 'Three'],
    basis: ['anatomy-general'],
    confidence: 'low',
    status: 'active',
    replacedBy: null,
    qa: { data: 'pending', motion: 'pending' },
    ...patch,
  })
}

export const BENCH = fixtureExercise(1, {
  name: 'Bench',
  equipment: ['barbell', 'flat_bench', 'rack'],
  groups: { chest: 'primary', front_delt: 'secondary', triceps: 'secondary' },
  heads: { pec_clavicular: 0.5, pec_sternal: 1 },
})
export const INCLINE_DB = fixtureExercise(2, {
  name: 'Incline DB press',
  pattern: 'incline_push',
  equipment: ['dumbbell', 'adjustable_bench'],
  groups: { chest: 'primary', front_delt: 'secondary', triceps: 'secondary' },
  heads: { pec_clavicular: 1, pec_sternal: 0.75 },
})
export const PUSH_UP = fixtureExercise(3, {
  name: 'Push-up',
  level: 1,
  groups: { chest: 'primary', triceps: 'secondary' },
})
export const ROW = fixtureExercise(4, {
  name: 'Cable row',
  pattern: 'horizontal_pull',
  equipment: ['cable'],
  groups: { upper_back: 'primary', lats: 'primary', rear_delt: 'secondary', biceps: 'secondary' },
})
export const PULL_UP = fixtureExercise(5, {
  name: 'Pull-up',
  pattern: 'vertical_pull',
  equipment: ['pullup_bar'],
  groups: { lats: 'primary', biceps: 'secondary' },
})
export const SQUAT = fixtureExercise(6, {
  name: 'Squat',
  pattern: 'squat',
  equipment: ['barbell', 'rack'],
  groups: { quads: 'primary', glute_max: 'primary', adductors: 'secondary' },
  heads: { rectus_femoris: 0.5, adductor_magnus: 1, adductor_longus: 0.5 },
})
export const RDL = fixtureExercise(7, {
  name: 'RDL',
  pattern: 'hinge',
  equipment: ['barbell'],
  groups: { hamstrings: 'primary', glute_max: 'primary', lower_back: 'secondary' },
})
export const LEG_CURL = fixtureExercise(8, {
  name: 'Seated leg curl',
  pattern: 'knee_flexion',
  mechanic: 'isolation',
  equipment: ['leg_curl_seated'],
  groups: { hamstrings: 'primary' },
  heads: { biceps_femoris_long: 0.5, biceps_femoris_short: 1, semitendinosus: 1, semimembranosus: 1 },
})
export const REAR_FLY = fixtureExercise(9, {
  name: 'Rear delt fly',
  pattern: 'shoulder_horizontal_abduction',
  mechanic: 'isolation',
  equipment: ['dumbbell'],
  groups: { rear_delt: 'primary', upper_back: 'secondary' },
})
export const LUNGE = fixtureExercise(10, {
  name: 'Reverse lunge',
  pattern: 'lunge',
  laterality: 'unilateral',
  equipment: ['dumbbell'],
  groups: { quads: 'primary', glute_max: 'primary' },
})
export const PUSHDOWN = fixtureExercise(11, {
  name: 'Pushdown',
  pattern: 'elbow_extension',
  mechanic: 'isolation',
  equipment: ['cable'],
  groups: { triceps: 'primary' },
  heads: { triceps_long: 0.75, triceps_lateral: 0.5 },
})
export const CURL = fixtureExercise(12, {
  name: 'Curl',
  pattern: 'elbow_flexion',
  mechanic: 'isolation',
  equipment: ['dumbbell'],
  groups: { biceps: 'primary', forearms: 'secondary' },
  heads: { biceps_brachii: 1, brachialis: 0.5 },
})
export const FLY = fixtureExercise(13, {
  name: 'Cable fly',
  pattern: 'shoulder_horizontal_adduction',
  mechanic: 'isolation',
  equipment: ['cable'],
  groups: { chest: 'primary' },
  heads: { pec_sternal: 1, pec_clavicular: 0.75 },
})
export const OLD_INCLINE = fixtureExercise(20, {
  name: 'Old incline press',
  pattern: 'incline_push',
  status: 'retired',
  replacedBy: 2,
  groups: { chest: 'primary' },
})

export const FIXTURES = [BENCH, INCLINE_DB, PUSH_UP, ROW, PULL_UP, SQUAT, RDL, LEG_CURL, REAR_FLY, LUNGE, PUSHDOWN, CURL, FLY, OLD_INCLINE]

export function catalogOf(...exercises: Exercise[]): Catalog {
  return new Map(exercises.map((e) => [e.id, e]))
}

export const CATALOG = catalogOf(...FIXTURES)

type DaySpec = { rest?: boolean; label?: string; entries?: [ExerciseRef, number][] }

/** Builds a program from a sparse day map; unspecified days are empty training days. */
export function programOf(days: Record<number, DaySpec | [ExerciseRef, number][]>, custom: Program['custom'] = []): Program {
  const id = sequentialIds('e')
  return {
    id: 'p1',
    name: 'Test',
    custom,
    days: [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const raw = days[d]
      const spec: DaySpec = Array.isArray(raw) ? { entries: raw } : (raw ?? {})
      return {
        kind: spec.rest ? 'rest' : 'train',
        ...(spec.label ? { label: spec.label } : {}),
        entries: (spec.entries ?? []).map(([ref, sets]) => ({ id: id(), exerciseId: ref, sets })),
      }
    }),
  }
}

export const TEMPLATE: SplitTemplate = {
  id: 'fixture-upper-lower',
  name: 'Fixture Upper/Lower',
  level: 1,
  daysPerWeek: 2,
  description: 'Test template',
  defaultDays: [0, 3],
  sessions: [
    {
      label: 'Upper',
      slots: [
        { pattern: 'horizontal_push', group: 'chest', sets: 3, reps: '6-8', options: [1, 2, 3] },
        { pattern: 'horizontal_pull', group: 'upper_back', sets: 3, options: [4] },
        { pattern: 'vertical_pull', group: 'lats', sets: 2, options: [5] },
      ],
    },
    {
      label: 'Lower',
      slots: [
        { pattern: 'squat', group: 'quads', sets: 4, options: [6, 10] },
        { pattern: 'knee_flexion', group: 'hamstrings', sets: 3, options: [8] },
      ],
    },
  ],
}

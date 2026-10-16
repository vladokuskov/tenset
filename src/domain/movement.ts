import type { Pattern } from './schema.ts'

export type MovementGroupId = 'push' | 'pull' | 'shoulders' | 'arms' | 'legs' | 'core'
/** A movement group, or "other" for exercises without a pattern (custom ones). */
export type MovementKey = MovementGroupId | 'other'
export type MovementMix = Record<MovementKey, number>

/** Movement groups in display order. Every pattern sits in exactly one group. */
export const MOVEMENT_GROUPS: readonly { id: MovementGroupId; patterns: readonly Pattern[] }[] = [
  { id: 'push', patterns: ['horizontal_push', 'incline_push', 'vertical_push', 'dip', 'shoulder_horizontal_adduction'] },
  { id: 'pull', patterns: ['horizontal_pull', 'vertical_pull', 'shoulder_extension', 'scapular_elevation'] },
  {
    id: 'shoulders',
    patterns: ['shoulder_abduction', 'shoulder_flexion', 'shoulder_horizontal_abduction', 'shoulder_external_rotation', 'scapular_upward_rotation'],
  },
  { id: 'arms', patterns: ['elbow_flexion', 'elbow_extension', 'wrist_flexion', 'wrist_extension'] },
  {
    id: 'legs',
    patterns: ['squat', 'lunge', 'hinge', 'hip_extension', 'knee_extension', 'knee_flexion', 'hip_abduction', 'hip_adduction', 'plantarflexion', 'dorsiflexion'],
  },
  {
    id: 'core',
    patterns: ['spinal_flexion', 'spinal_extension', 'hip_flexion', 'anti_extension', 'anti_lateral_flexion', 'anti_rotation', 'rotation'],
  },
]

export const MOVEMENT_KEYS: readonly MovementKey[] = [...MOVEMENT_GROUPS.map((g) => g.id), 'other']

/** Group names per language, shared by the app UI and exports. */
export const movementGroupNames: Record<'en' | 'uk', Readonly<Record<MovementKey, string>>> = {
  en: { push: 'Push', pull: 'Pull', shoulders: 'Shoulders', arms: 'Arms', legs: 'Legs and hips', core: 'Core', other: 'Other' },
  uk: { push: 'Жим', pull: 'Тяга', shoulders: 'Плечі', arms: 'Руки', legs: 'Ноги й таз', core: 'Кор', other: 'Інше' },
}

const GROUP_OF = new Map<Pattern, MovementGroupId>(MOVEMENT_GROUPS.flatMap((g) => g.patterns.map((p) => [p, g.id] as const)))

export function movementGroupOf(pattern: Pattern | null | undefined): MovementKey {
  return (pattern && GROUP_OF.get(pattern)) || 'other'
}

export function emptyMix(): MovementMix {
  return { push: 0, pull: 0, shoulders: 0, arms: 0, legs: 0, core: 0, other: 0 }
}

/** Sets per movement group. Exercises without a pattern count under "other". */
export function movementMix(entries: Iterable<{ sets: number; exercise: { pattern: Pattern | null } }>): MovementMix {
  const mix = emptyMix()
  for (const e of entries) mix[movementGroupOf(e.exercise.pattern)] += e.sets
  return mix
}

export function mixTotal(mix: MovementMix): number {
  return MOVEMENT_KEYS.reduce((s, k) => s + mix[k], 0)
}

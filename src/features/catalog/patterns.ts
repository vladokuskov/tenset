import type { Pattern } from '../../domain/schema'

export const PATTERN_LABEL: Record<Pattern, string> = {
  horizontal_push: 'Horizontal press',
  incline_push: 'Incline press',
  vertical_push: 'Overhead press',
  dip: 'Dip',
  horizontal_pull: 'Row',
  vertical_pull: 'Vertical pull',
  squat: 'Squat',
  lunge: 'Lunge',
  hinge: 'Hip hinge',
  hip_extension: 'Hip extension',
  knee_extension: 'Leg extension',
  knee_flexion: 'Leg curl',
  elbow_flexion: 'Curl',
  elbow_extension: 'Triceps extension',
  shoulder_abduction: 'Lateral raise',
  shoulder_flexion: 'Front raise',
  shoulder_horizontal_abduction: 'Rear delt fly',
  shoulder_horizontal_adduction: 'Chest fly',
  shoulder_external_rotation: 'External rotation',
  scapular_elevation: 'Shrug',
  scapular_upward_rotation: 'Y-raise',
  plantarflexion: 'Calf raise',
  dorsiflexion: 'Tibialis raise',
  wrist_flexion: 'Wrist curl',
  wrist_extension: 'Reverse wrist curl',
  hip_abduction: 'Hip abduction',
  hip_adduction: 'Hip adduction',
  hip_flexion: 'Leg raise',
  spinal_extension: 'Back extension',
  spinal_flexion: 'Crunch',
  anti_extension: 'Plank',
  anti_lateral_flexion: 'Side plank',
  anti_rotation: 'Anti-rotation',
  rotation: 'Rotation',
}

/** Pattern groups for pickers, in display order. */
export const PATTERN_GROUPS: readonly { label: string; patterns: readonly Pattern[] }[] = [
  { label: 'Push', patterns: ['horizontal_push', 'incline_push', 'vertical_push', 'dip', 'shoulder_horizontal_adduction'] },
  { label: 'Pull', patterns: ['horizontal_pull', 'vertical_pull', 'scapular_elevation'] },
  {
    label: 'Shoulders',
    patterns: ['shoulder_abduction', 'shoulder_flexion', 'shoulder_horizontal_abduction', 'shoulder_external_rotation', 'scapular_upward_rotation'],
  },
  { label: 'Arms', patterns: ['elbow_flexion', 'elbow_extension', 'wrist_flexion', 'wrist_extension'] },
  {
    label: 'Legs and hips',
    patterns: ['squat', 'lunge', 'hinge', 'hip_extension', 'knee_extension', 'knee_flexion', 'hip_abduction', 'hip_adduction', 'plantarflexion', 'dorsiflexion'],
  },
  {
    label: 'Core',
    patterns: ['spinal_flexion', 'spinal_extension', 'hip_flexion', 'anti_extension', 'anti_lateral_flexion', 'anti_rotation', 'rotation'],
  },
]

export const LEVEL_LABEL: Record<number, string> = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced' }

export function patternLabel(pattern: Pattern | undefined): string {
  return pattern ? PATTERN_LABEL[pattern] : ''
}

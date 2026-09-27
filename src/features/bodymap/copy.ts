import type { MainPattern, MissingPatternKind } from '../../domain/coverage'
import { dayName } from '../../app/days'
import type { GroupSchedule } from '../../domain/recovery'
import { RECOVERY_MIN_SETS } from '../../domain/recovery'

export const MISSING_PATTERN: Record<MissingPatternKind, { label: string; examples: string; why: string }> = {
  horizontal_pull: { label: 'Horizontal pull', examples: 'rows', why: 'No exercise in this program is a row.' },
  vertical_pull: {
    label: 'Vertical pull',
    examples: 'pull-ups, pulldowns',
    why: 'No exercise in this program pulls from overhead.',
  },
  knee_flexion: { label: 'Knee flexion', examples: 'leg curls', why: 'No exercise in this program bends the knee against load.' },
  hip_hinge: { label: 'Hip hinge', examples: 'deadlifts, RDLs', why: 'No exercise in this program is a hip hinge.' },
  direct_rear_delt: {
    label: 'Direct rear delt work',
    examples: 'rear delt flys, face pulls',
    why: 'No exercise in this program has rear delts as a primary muscle.',
  },
}

export const MAIN_PATTERN_LABEL: Record<MainPattern, string> = {
  squat: 'Squat',
  hinge: 'Hinge',
  horizontal_push: 'Horizontal push',
  vertical_push: 'Vertical push',
  horizontal_pull: 'Horizontal pull',
  vertical_pull: 'Vertical pull',
}

/** Neutral schedule line: "Trained Mon, Thu, Sat · gaps 3, 2, 2 days". */
export function scheduleText(schedule: GroupSchedule | undefined, weekly: number): string {
  if (weekly <= 0) return 'Not trained this week'
  if (!schedule || schedule.days.length === 0) return `No day reaches ${RECOVERY_MIN_SETS} sets`
  const days = schedule.days.map((d) => dayName(d)).join(', ')
  if (schedule.days.length === 1) return `Trained ${days} · once a week`
  return `Trained ${days} · gaps ${schedule.gaps.join(', ')} days`
}

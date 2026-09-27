import type { GripName } from './hands'
import type { FigureHighlight } from './highlight'
import { DUMBBELL_D, DUMBBELL_GRIP, type PoseName } from './poses'
import type { BenchParams } from './props/sockets'
import type { ViewName } from './views'

// Static exercise stills for look development (FK poses, no motion system yet).

export type ExerciseScene = {
  /** exercise record id (data/exercises); the highlight mirrors its groups */
  exercise: number
  pose: PoseName
  view: ViewName
  highlight: FigureHighlight
  dumbbells?: boolean
  /** the hands' grip (hands.ts), carried by the pose; held props find the handle from it */
  grip?: { name: GripName; diameter: number }
  /** bench fitted under a seated figure */
  bench?: BenchParams
}

export const scenes = {
  'db-curl': {
    exercise: 711,
    pose: 'db-curl-mid',
    view: 'hero',
    highlight: { primary: ['biceps_brachii', 'brachialis'], secondary: ['forearms'] },
    dumbbells: true,
    grip: { name: DUMBBELL_GRIP.curl, diameter: DUMBBELL_D },
  },
  'db-lateral-raise': {
    exercise: 203,
    pose: 'db-lateral-raise-top',
    view: 'hero',
    highlight: { primary: ['side_delt'], secondary: ['rear_delt', 'rotator_cuff', 'upper_traps'] },
    dumbbells: true,
    grip: { name: DUMBBELL_GRIP.raise, diameter: DUMBBELL_D },
  },
  'db-shoulder-press': {
    exercise: 202,
    pose: 'db-shoulder-press-bottom',
    view: 'hero',
    highlight: { primary: ['front_delt'], secondary: ['side_delt', 'triceps', 'upper_traps', 'serratus'] },
    dumbbells: true,
    grip: { name: DUMBBELL_GRIP.press, diameter: DUMBBELL_D },
    bench: { back: 85 },
  },
} satisfies Record<string, ExerciseScene>

export type SceneName = keyof typeof scenes

export function isSceneName(s: unknown): s is SceneName {
  return typeof s === 'string' && s in scenes
}

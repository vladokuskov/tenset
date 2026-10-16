import { movementGroupOf, type MovementKey } from '../../domain/movement'
import type { AnyExercise } from '../shared/exercise'

/** Custom exercises have no pattern, so they land in "other". */
export const groupOf = (e: AnyExercise): MovementKey => movementGroupOf('pattern' in e ? e.pattern : null)

import type { DayIndex } from '../../../app/days'
import type { AnyExercise } from '../labels'

// The week board keeps its own dnd provider and exposes no drop or highlight hooks, so the desktop
// layer binds to its day columns (regions named after the day) and entry links from the outside.

/** dnd type of drawer rows; only the day drop zones accept it. */
export const DRAWER_ITEM = 'drawer-exercise'

export type DrawerDragData = { exercise: AnyExercise }
export type DayDropData = { day: DayIndex }

/** Set on a day column while a drawer row is over it. */
export const OVER_ATTR = 'data-drawer-over'

/** Ring for the column under a dragged drawer row. */
export const DROP_CSS = `section[${OVER_ATTR}]{box-shadow:0 0 0 2px var(--color-accent)}`

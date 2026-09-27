import type { AnyExercise } from '../labels'

/** dnd type of catalog drawer rows; the week board's day columns accept it. */
export const DRAWER_ITEM = 'drawer-exercise'

export type DrawerDragData = { exercise: AnyExercise }

/** Focus target of the drawer's "Skip to week board" link. */
export const WEEK_BOARD_ID = 'week-board'

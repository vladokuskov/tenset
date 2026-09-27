import { useDroppable } from '@dnd-kit/react'
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { DAY_LONG, type DayIndex } from '../../../app/days'
import { DRAWER_ITEM, OVER_ATTR, type DayDropData } from './board'

type Props = { day: DayIndex; board: RefObject<HTMLElement | null> }

function DayDrop({ day, board }: Props) {
  const data: DayDropData = { day }
  const { ref, isDropTarget } = useDroppable({ id: `drawer-day:${day}`, accept: DRAWER_ITEM, data })
  const column = useRef<Element | null>(null)

  // Re-bound after every render: the column belongs to the board, which may replace it.
  useLayoutEffect(() => {
    column.current = board.current?.querySelector(`section[aria-label="${DAY_LONG[day]}"]`) ?? null
    ref(column.current)
  })

  useEffect(() => {
    const el = column.current
    el?.toggleAttribute(OVER_ATTR, isDropTarget)
    return () => el?.removeAttribute(OVER_ATTR)
  }, [isDropTarget])

  return null
}

/** Drop zones for drawer rows over the board's day columns. Must render inside the drawer's provider. */
export function DayDrops({ days, board }: { days: readonly DayIndex[]; board: RefObject<HTMLElement | null> }) {
  return days.map((d) => <DayDrop key={d} day={d} board={board} />)
}

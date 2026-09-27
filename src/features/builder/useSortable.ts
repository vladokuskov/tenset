import { useDroppable } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'

export const ITEM = 'sortable-item'
export const LIST_PREFIX = 'list:'

export function useSortableItem(id: string, index: number, list: string, disabled = false) {
  const { ref, handleRef, isDragging } = useSortable({ id, index, group: list, type: ITEM, accept: ITEM, disabled })
  return { ref, handleRef, isDragging }
}

/** Drop zone for a whole list, so empty lists accept items. `also` adds other draggable types it accepts. */
export function useSortableList(list: string, also?: string) {
  const { ref, isDropTarget } = useDroppable({
    id: LIST_PREFIX + list,
    type: 'list',
    accept: also ? [ITEM, also] : ITEM,
    collisionPriority: 1,
  })
  return { ref, isDropTarget }
}

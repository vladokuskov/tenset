import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import { useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { LIST_PREFIX } from './useSortable'

// Thin adapter over @dnd-kit/react (pre-1.0, pinned). Screens only see lists of ids and moves.

export type SortLists = Readonly<Record<string, readonly string[]>>

export type SortMove = { id: string; fromList: string; fromIndex: number; toList: string; toIndex: number }

// Handles start a drag at once (touch included, they set touch-action: none); elsewhere the
// library defaults apply (press delay on touch, small distance with a mouse so clicks still work).
const sensors = [
  PointerSensor.configure({
    activationConstraints(event, source) {
      const target = event.target
      if (source.handle && target instanceof Node && source.handle.contains(target)) return undefined
      const fallback = PointerSensor.defaults.activationConstraints
      return typeof fallback === 'function' ? fallback(event, source) : fallback
    },
  }),
  // Space only, so Enter still activates board cards (links) instead of picking them up.
  KeyboardSensor.configure({ keyboardCodes: { ...KeyboardSensor.defaults.keyboardCodes, start: ['Space'] } }),
]

type PluginList = Extract<NonNullable<ComponentProps<typeof DragDropProvider>['plugins']>, readonly unknown[]>
type Named = { id: string | number; element?: Element | null } | null | undefined

// The default screen reader announcements read raw ids; swap in names. Found by its options
// (property names survive minification) since the plugin class is not exported by @dnd-kit/react.
const isAccessibilityPlugin = (p: unknown) =>
  typeof p === 'function' && Function.prototype.toString.call(p).includes('screenReaderInstructions')

/** Sortable elements and list drop zones carry their spoken name in this attribute. */
export const SORT_LABEL = 'data-sort-label'

function announcementPlugins() {
  const label = (x: Named) => x?.element?.getAttribute(SORT_LABEL) ?? 'item'
  const options = {
    screenReaderInstructions: {
      draggable: 'To reorder, press Space, move with the arrow keys, then press Space again to drop. Escape cancels.',
    },
    announcements: {
      dragstart: ({ operation }: { operation: { source: Named } }) => (operation.source ? `Picked up ${label(operation.source)}.` : undefined),
      dragover: ({ operation }: { operation: { source: Named; target: Named } }) =>
        operation.source && operation.target && operation.source.id !== operation.target.id
          ? `${label(operation.source)} is over ${label(operation.target)}.`
          : undefined,
      dragend: ({ operation, canceled }: { operation: { source: Named }; canceled: boolean }) =>
        operation.source ? (canceled ? `Cancelled. ${label(operation.source)} is back in place.` : `Dropped ${label(operation.source)}.`) : undefined,
    },
  }
  return (defaults: PluginList): PluginList =>
    defaults.map((p) =>
      isAccessibilityPlugin(p) ? (p as unknown as { configure: (o: typeof options) => PluginList[number] }).configure(options) : p,
    ) as PluginList
}

const plugins = announcementPlugins()

type Point = { x: number; y: number }
type TargetLike = { id: string | number; shape?: { center: Point } } | null | undefined

function locate(lists: SortLists, id: string): { list: string; index: number } | null {
  for (const [list, ids] of Object.entries(lists)) {
    const index = ids.indexOf(id)
    if (index >= 0) return { list, index }
  }
  return null
}

function reorderDraft(lists: SortLists, sourceId: string, target: TargetLike, pointer: Point | undefined): SortLists {
  if (!target) return lists
  const from = locate(lists, sourceId)
  if (!from) return lists
  const targetId = String(target.id)
  let to = locate(lists, targetId)
  if (!to && targetId.startsWith(LIST_PREFIX)) {
    const list = targetId.slice(LIST_PREFIX.length)
    if (!(list in lists) || list === from.list) return lists
    const below = pointer && target.shape ? pointer.y > target.shape.center.y : true
    to = { list, index: below ? lists[list].length : 0 }
  } else if (to && to.list !== from.list && pointer && target.shape && pointer.y > target.shape.center.y) {
    to = { list: to.list, index: to.index + 1 }
  }
  if (!to || (to.list === from.list && to.index === from.index)) return lists

  const next: Record<string, string[]> = { ...lists } as Record<string, string[]>
  const src = [...lists[from.list]]
  src.splice(from.index, 1)
  next[from.list] = src
  const dst = to.list === from.list ? src : [...lists[to.list]]
  dst.splice(Math.min(to.index, dst.length), 0, sourceId)
  next[to.list] = dst
  return next
}

export type SortableListsProps = {
  lists: SortLists
  onMove: (move: SortMove) => void
  /** Renders with the in-flight order while dragging. */
  children: (lists: SortLists) => ReactNode
}

export function SortableLists({ lists, onMove, children }: SortableListsProps) {
  const [draft, setDraft] = useState<SortLists | null>(null)
  const draftRef = useRef<SortLists | null>(null)
  const put = (next: SortLists | null) => {
    draftRef.current = next
    setDraft(next)
  }

  return (
    <DragDropProvider
      sensors={sensors}
      plugins={plugins}
      onDragStart={() => put(lists)}
      onDragOver={(event, manager) => {
        const base = draftRef.current ?? lists
        const sourceId = event.operation.source?.id
        const next =
          sourceId == null
            ? base
            : reorderDraft(base, String(sourceId), event.operation.target, manager.dragOperation.position.current)
        // Unchanged: stop the optimistic DOM sort so React stays the only writer.
        if (next === base) event.preventDefault()
        else put(next)
      }}
      onDragEnd={(event) => {
        const final = draftRef.current
        put(null)
        const id = event.operation.source?.id
        if (event.canceled || !final || id == null) return
        const from = locate(lists, String(id))
        const to = locate(final, String(id))
        if (from && to && (from.list !== to.list || from.index !== to.index)) {
          onMove({ id: String(id), fromList: from.list, fromIndex: from.index, toList: to.list, toIndex: to.index })
        }
      }}
    >
      {children(draft ?? lists)}
    </DragDropProvider>
  )
}

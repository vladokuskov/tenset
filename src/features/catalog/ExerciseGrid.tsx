import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Exercise } from '../../domain/schema'
import { ExerciseCard } from './ExerciseCard'

const GAP = 12
// Card text under the media: two name lines, one meta line, spacing.
const TEXT_H = 62

function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

/** Virtualized card grid on the window scroller: two columns on phones, three from 560px. */
export function ExerciseGrid({ exercises, label }: { exercises: readonly Exercise[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref)
  const cols = width >= 560 ? 3 : 2
  const rows = Math.ceil(exercises.length / cols)
  const cardW = width ? (width - GAP * (cols - 1)) / cols : 170
  const [offset, setOffset] = useState(0)

  // Distance from the document top to the grid, so window scroll maps onto rows.
  useLayoutEffect(() => {
    const el = ref.current
    if (el) setOffset(el.getBoundingClientRect().top + window.scrollY)
  }, [width, exercises])

  const virtualizer = useWindowVirtualizer({
    count: rows,
    estimateSize: () => Math.round(cardW * 1.25 + TEXT_H + GAP),
    overscan: 3,
    scrollMargin: offset,
  })

  return (
    <div ref={ref} role="list" aria-label={label} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => {
        const items = exercises.slice(row.index * cols, row.index * cols + cols)
        return (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 grid w-full"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              columnGap: GAP,
              paddingBottom: GAP,
              transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            {items.map((e, i) => (
              <div key={e.id} role="listitem" aria-setsize={exercises.length} aria-posinset={row.index * cols + i + 1}>
                <ExerciseCard exercise={e} />
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

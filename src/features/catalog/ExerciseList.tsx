import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useLayoutEffect, useRef, useState } from 'react'
import type { Exercise } from '../../domain/schema'
import { useLocale } from '../../i18n/messages'
import { movementLabel } from '../../ui/movement'
import { exerciseGroup } from './media'
import { ExerciseRow } from './ExerciseRow'

const ROW_H = 73

/** Virtualized compact list on the window scroller: poster, name, muscles and movement group per row. */
export function ExerciseList({ exercises, label }: { exercises: readonly Exercise[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const locale = useLocale()
  const [offset, setOffset] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (el) setOffset(el.getBoundingClientRect().top + window.scrollY)
  }, [exercises])

  const virtualizer = useWindowVirtualizer({
    count: exercises.length,
    estimateSize: () => ROW_H,
    overscan: 6,
    scrollMargin: offset,
  })

  return (
    <div
      ref={ref}
      role="list"
      aria-label={label}
      className="relative w-full rounded-xl bg-surface"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const e = exercises[item.index]
        return (
          <div
            key={e.id}
            data-index={item.index}
            ref={virtualizer.measureElement}
            role="listitem"
            aria-setsize={exercises.length}
            aria-posinset={item.index + 1}
            className="absolute left-0 top-0 w-full border-line px-3 [&:not(:first-child)]:border-t"
            style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
          >
            <ExerciseRow
              exercise={e}
              link
              trailing={<span className="max-w-20 text-right text-xs leading-tight text-ink-3">{movementLabel(exerciseGroup(e), locale)}</span>}
            />
          </div>
        )
      })}
    </div>
  )
}

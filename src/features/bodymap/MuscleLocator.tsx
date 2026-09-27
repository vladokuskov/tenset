import { useMemo } from 'react'
import { cx } from '../../ui/cx'
import { cropViewBox, regionBounds, useAnatomy, type AnatomyDoc, type Bounds } from './anatomy'
import { AnatomyFigure } from './AnatomyFigure'

const area = (b: Bounds | null) => (b ? (b.x1 - b.x0) * (b.y1 - b.y0) : 0)

function boundsOf(doc: AnatomyDoc | null, group: string, head?: string) {
  return doc ? regionBounds(doc, (r) => (head ? r.head === head : r.group === group)) : null
}

/** Small cropped map that shows where a group (or one of its heads) sits. */
export function MuscleLocator({
  group,
  head,
  fill,
  size = 88,
  className,
}: {
  group: string
  head?: string
  /** CSS color for the group; the rest of the body stays neutral. */
  fill: string
  size?: number
  className?: string
}) {
  const front = useAnatomy('front', 'full')
  const back = useAnatomy('back', 'full')
  const { view, viewBox } = useMemo(() => {
    const f = boundsOf(front, group, head)
    const b = boundsOf(back, group, head)
    const useBack = area(b) > area(f)
    const box = useBack ? b : f
    return { view: useBack ? ('back' as const) : ('front' as const), viewBox: box ? cropViewBox(box, 1, 640, 0.18) : undefined }
  }, [front, back, group, head])

  const vars = { [head ? `--h-${head}` : `--g-${group}`]: fill, '--gb-line': 'var(--color-map-gap)', '--gb-line-w': '0.5px' }
  return (
    <div
      className={cx('shrink-0 overflow-hidden rounded-lg bg-surface-2', className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {viewBox && <AnatomyFigure view={view} kind="full" viewBox={viewBox} vars={vars} className="block size-full" />}
    </div>
  )
}

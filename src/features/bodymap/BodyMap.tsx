import { ZoomIn, ZoomOut } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import { hitTest, pickGroup, viewBoxToRaster } from '../../domain/idRaster'
import type { MapScale } from '../../app/volumeScale'
import { useMessages } from '../../i18n/messages'
import { cx } from '../../ui/cx'
import { IconButton } from '../../ui/IconButton'
import { SegmentedControl } from '../../ui/SegmentedControl'
import {
  MAP_ASPECT,
  MAP_HEIGHT,
  MAP_WIDTH,
  regionBounds,
  TAP_RADIUS_PX,
  useAnatomy,
  useIdRaster,
  type AnatomyRegion,
  type AnatomyView,
} from './anatomy'
import { regionFill, tintVars, valueVars, type BodyTint, type BodyValues } from './fills'
import { bodymapMessages } from './messages'
import { MuscleChooser, type ChooserState } from './MuscleChooser'

export type BodyView = 'front' | 'back' | 'both'
export type { BodyTint, BodyValues }

export type BodyMapProps = {
  view: BodyView
  /** Fractional sets for the scope: week totals (WeekResult.weekly, .shade.weekly) or one day's column. */
  values: BodyValues
  /** Which values drive the fills. Bands are group-level, so groups is the default. */
  shade?: 'groups' | 'heads'
  /** Week uses weekly band edges; day uses the same edges scaled to one session. */
  scale: MapScale
  /** Group ids drawn with an outline (selected muscle, hovered entry). */
  highlight?: readonly string[]
  /** Exercise mode: primary groups in the strong tint, secondary in the light one. Replaces volume fills. */
  tint?: BodyTint
  /** Tap on the map. Pointer only: the coverage list is the accessible equivalent. */
  onSelectGroup?: (group: string) => void
  /** Mouse or pen over a muscle group, null when it leaves the muscles. Touch never hovers. */
  onHoverGroup?: (group: string | null) => void
  /** Shows a zoom button that renders one view at 2x in a scroll box. */
  zoomable?: boolean
  /** Accessible name for the figure. */
  label?: string
  className?: string
}

const GAP = 12
// figcaption height (mt-1.5 + one xs line) so zooming keeps the panel height.
const CAPTION_PX = 22
// Tighter than a tap: hover follows the pointer and only names a group it is clearly over.
const HOVER_RADIUS_PX = 3

// Screen x to the subject's side: the front view shows the subject's right on the viewer's left.
const sideAt = (view: AnatomyView, x: number): 'l' | 'r' => (x < MAP_WIDTH / 2) === (view === 'front') ? 'r' : 'l'

type FigureProps = {
  view: AnatomyView
  width: string
  interactive: boolean
  highlight?: readonly string[]
  outline?: { groups: readonly string[]; side: 'l' | 'r' }
  caption?: boolean
  onTap?: (view: AnatomyView, e: MouseEvent<SVGSVGElement>) => void
  onHover?: (view: AnatomyView, e: PointerEvent<SVGSVGElement> | null) => void
}

function Outline({ regions, width }: { regions: AnatomyRegion[]; width: number }) {
  return regions.map((r, i) => (
    <path
      key={i}
      d={r.d}
      fillRule={r.evenodd ? 'evenodd' : undefined}
      fill="none"
      stroke="var(--color-ink)"
      strokeWidth={width}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  ))
}

function Figure({ view, width, interactive, highlight, outline, caption, onTap, onHover }: FigureProps) {
  const doc = useAnatomy(view, 'full')
  const m = useMessages(bodymapMessages)
  const regions = doc?.regions ?? []
  return (
    <figure className="m-0 flex shrink-0 flex-col items-center" style={{ width }}>
      <div className="w-full" style={{ aspectRatio: String(MAP_ASPECT) }}>
        {doc && (
          <svg
            viewBox={doc.viewBox}
            className={cx('block h-full w-full select-none', interactive && 'cursor-pointer')}
            aria-hidden
            focusable="false"
            data-bodymap=""
            onClick={interactive && onTap ? (e) => onTap(view, e) : undefined}
            onPointerMove={onHover ? (e) => onHover(view, e) : undefined}
            onPointerLeave={onHover ? () => onHover(view, null) : undefined}
          >
            {doc.silhouette.map((p, i) => (
              <path key={i} d={p.d} fillRule={p.evenodd ? 'evenodd' : undefined} fill="var(--color-map-skin)" />
            ))}
            {regions.map((r, i) => (
              <path
                key={i}
                d={r.d}
                fillRule={r.evenodd ? 'evenodd' : undefined}
                stroke="var(--color-map-gap)"
                strokeWidth={0.75}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ fill: regionFill(r.group, r.head, r.untracked), transition: 'fill 0.3s var(--ease-out)' }}
              />
            ))}
            {highlight?.length ? (
              <Outline regions={regions.filter((r) => r.group && highlight.includes(r.group))} width={1.75} />
            ) : null}
            {outline && (
              <Outline
                regions={regions.filter((r) => r.group && r.side === outline.side && outline.groups.includes(r.group))}
                width={1.5}
              />
            )}
          </svg>
        )}
      </div>
      {caption && <figcaption className="mt-1.5 text-xs text-ink-3">{view === 'front' ? m.front : m.back}</figcaption>}
    </figure>
  )
}

/** Head-level front/back map shaded on the single-hue volume scale, with tap hit-testing and zoom. */
export function BodyMap({
  view,
  values,
  shade = 'groups',
  scale,
  highlight,
  tint,
  onSelectGroup,
  onHoverGroup,
  zoomable,
  label,
  className,
}: BodyMapProps) {
  const m = useMessages(bodymapMessages)
  const wrapRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [zoomed, setZoomed] = useState(false)
  const [zoomView, setZoomView] = useState<AnatomyView>(view === 'back' ? 'back' : 'front')
  const [chooserState, setChooser] = useState<(ChooserState & { layout: string }) | null>(null)
  const interactive = Boolean(onSelectGroup)
  const views: AnatomyView[] = zoomed ? [zoomView] : view === 'both' ? ['front', 'back'] : [view]

  const sampled = interactive || Boolean(onHoverGroup)
  const frontRaster = useIdRaster('front', sampled && views.includes('front'))
  const backRaster = useIdRaster('back', sampled && views.includes('back'))
  const hovered = useRef<string | null>(null)
  const zoomDoc = useAnatomy(zoomView, 'full')

  const vars = useMemo(() => (tint ? tintVars(tint) : valueVars(values, shade, scale)), [tint, values, shade, scale])

  if (view !== 'both' && zoomView !== view) setZoomView(view)

  // A chooser belongs to the layout it was opened in.
  const layout = `${view}:${zoomed ? zoomView : ''}`
  const chooser = chooserState?.layout === layout ? chooserState : null

  // Scroll once after entering zoom or switching the zoomed view, centered on the highlight if any.
  const scrollPending = useRef(false)
  useLayoutEffect(() => {
    const box = scrollRef.current
    if (!scrollPending.current || !zoomed || !box || !zoomDoc) return
    scrollPending.current = false
    const b = highlight?.length ? regionBounds(zoomDoc, (r) => !!r.group && highlight.includes(r.group)) : null
    const k = box.scrollHeight / MAP_HEIGHT
    const target = b ? ((b.y0 + b.y1) / 2) * k - box.clientHeight / 2 : box.scrollHeight * 0.12
    box.scrollTop = Math.max(0, target)
  }, [zoomed, zoomView, zoomDoc, highlight])

  const toggleZoom = () => {
    scrollPending.current = !zoomed
    setZoomed(!zoomed)
  }
  const switchZoomView = (v: AnatomyView) => {
    scrollPending.current = true
    setZoomView(v)
  }

  const onTap = (v: AnatomyView, e: MouseEvent<SVGSVGElement>) => {
    const raster = v === 'front' ? frontRaster : backRaster
    const wrap = wrapRef.current
    if (!onSelectGroup || !raster || !wrap) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * MAP_WIDTH
    const y = ((e.clientY - rect.top) / rect.height) * MAP_HEIGHT
    const [cx, cy] = viewBoxToRaster(raster, x, y)
    const hits = hitTest(raster, cx, cy, (TAP_RADIUS_PX * raster.height) / rect.height)
    const pick = pickGroup(hits)
    if (pick || !hits.length) {
      setChooser(null)
      if (pick) onSelectGroup(pick)
      return
    }
    const w = wrap.getBoundingClientRect()
    setChooser({
      layout,
      view: v,
      side: sideAt(v, x),
      groups: hits.slice(0, 4).map((h) => h.group),
      x: e.clientX - w.left,
      y: e.clientY - w.top,
    })
  }

  const onHover = (v: AnatomyView, e: PointerEvent<SVGSVGElement> | null) => {
    if (e?.pointerType === 'touch') return
    let group: string | null = null
    const raster = v === 'front' ? frontRaster : backRaster
    if (e && raster) {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * MAP_WIDTH
      const y = ((e.clientY - rect.top) / rect.height) * MAP_HEIGHT
      const [cx, cy] = viewBoxToRaster(raster, x, y)
      const top = hitTest(raster, cx, cy, (HOVER_RADIUS_PX * raster.height) / rect.height)[0]
      group = top && top.share >= 0.5 ? top.group : null
    }
    if (group === hovered.current) return
    hovered.current = group
    onHoverGroup?.(group)
  }

  const figureWidth = `calc((100cqw - ${GAP}px) / 2)`
  const figures = views.map((v) => (
    <Figure
      key={v}
      view={v}
      width={zoomed ? `calc(100cqw - ${GAP}px)` : figureWidth}
      interactive={interactive}
      highlight={highlight}
      outline={chooser && chooser.view === v ? { groups: chooser.groups, side: chooser.side } : undefined}
      caption={!zoomed}
      onTap={onTap}
      onHover={onHoverGroup ? onHover : undefined}
    />
  ))

  return (
    <div
      ref={wrapRef}
      className={cx('relative w-full', className)}
      style={{ containerType: 'inline-size', ...(vars as CSSProperties) }}
    >
      <div role="img" aria-label={label ?? m.bodyMap}>
        {zoomed ? (
          <div
            ref={scrollRef}
            className="relative mx-auto flex justify-center overflow-auto overscroll-contain rounded-lg bg-surface-2/40"
            style={{ height: `calc((100cqw - ${GAP}px) / 2 / ${MAP_ASPECT} + ${CAPTION_PX}px)` }}
            onScroll={chooser ? () => setChooser(null) : undefined}
          >
            {figures}
          </div>
        ) : (
          <div className="flex items-start justify-center" style={{ gap: GAP }}>
            {figures}
          </div>
        )}
      </div>

      {zoomable && (
        <div className="pointer-events-none absolute inset-x-1 top-1 flex items-start justify-between gap-2">
          {zoomed && view === 'both' ? (
            <SegmentedControl
              label={m.zoomedView}
              size="sm"
              className="glass pointer-events-auto shadow-thumb"
              options={[
                { value: 'front', label: m.front },
                { value: 'back', label: m.back },
              ]}
              value={zoomView}
              onChange={switchZoomView}
            />
          ) : (
            <span />
          )}
          <IconButton
            icon={zoomed ? ZoomOut : ZoomIn}
            label={zoomed ? m.zoomOut : m.zoomIn}
            size={36}
            variant="tonal"
            aria-pressed={zoomed}
            className={cx('pointer-events-auto', zoomed && 'glass shadow-thumb')}
            onClick={toggleZoom}
          />
        </div>
      )}

      {chooser && onSelectGroup && (
        <MuscleChooser
          state={chooser}
          values={values}
          scale={scale}
          container={wrapRef}
          onPick={(g) => {
            setChooser(null)
            onSelectGroup(g)
          }}
          onClose={() => setChooser(null)}
        />
      )}
    </div>
  )
}

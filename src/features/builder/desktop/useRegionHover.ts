import { useRef, type PointerEvent } from 'react'
import { hitTest, viewBoxToRaster } from '../../../domain/idRaster'
import { MAP_HEIGHT, MAP_WIDTH, useIdRaster } from '../../bodymap/anatomy'

// BodyMap only reports taps, so hover samples the same ID rasters it uses for hit-testing.
const HOVER_RADIUS_PX = 3

/**
 * Pointer handlers for a wrapper around an unzoomed `view="both"` BodyMap: reports the group under
 * a mouse or pen, or null when the pointer leaves the muscles.
 */
export function useRegionHover(onGroup: (group: string | null) => void) {
  const front = useIdRaster('front')
  const back = useIdRaster('back')
  const last = useRef<string | null>(null)

  const emit = (group: string | null) => {
    if (group === last.current) return
    last.current = group
    onGroup(group)
  }

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') return
    const svg = e.target instanceof Element ? e.target.closest('svg[data-bodymap]') : null
    if (!svg || !e.currentTarget.contains(svg)) return emit(null)
    const figures = [...e.currentTarget.querySelectorAll('svg[data-bodymap]')]
    const raster = figures.indexOf(svg) === 0 ? front : back
    if (!raster) return
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * MAP_WIDTH
    const y = ((e.clientY - rect.top) / rect.height) * MAP_HEIGHT
    const [cx, cy] = viewBoxToRaster(raster, x, y)
    const top = hitTest(raster, cx, cy, (HOVER_RADIUS_PX * raster.height) / rect.height)[0]
    emit(top && top.share >= 0.5 ? top.group : null)
  }

  return { onPointerMove, onPointerLeave: () => emit(null) }
}

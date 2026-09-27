import type { CSSProperties } from 'react'
import { MAP_HEIGHT, MAP_WIDTH, symbolId, useAnatomy, type AnatomyKind, type AnatomyView } from './anatomy'

export type FigureVars = Record<`--${string}`, string>

export type AnatomyFigureProps = {
  view: AnatomyView
  kind: AnatomyKind
  /** CSS variables read by the shared symbol: --g-<group>, --h-<head>, --gb-rest, --gb-skin, --gb-line. */
  vars?: FigureVars
  /** Crop in map units; defaults to the whole figure. */
  viewBox?: string
  className?: string
  style?: CSSProperties
}

/** Draws the shared map symbol with <use>; decorative (the caller supplies any accessible name). */
export function AnatomyFigure({ view, kind, vars, viewBox, className, style }: AnatomyFigureProps) {
  const doc = useAnatomy(view, kind)
  return (
    <svg
      viewBox={viewBox ?? `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ ...style, ...(vars as CSSProperties) }}
      aria-hidden
      focusable="false"
    >
      {doc && <use href={`#${symbolId(view, kind)}`} width={MAP_WIDTH} height={MAP_HEIGHT} />}
    </svg>
  )
}

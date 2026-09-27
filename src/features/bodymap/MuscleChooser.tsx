import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { formatSets } from '../../app/format'
import { groupShade, VOLUME_COLOR, type MapScale } from '../../app/volumeScale'
import { getGroup } from '../../domain/taxonomy'
import { TAP_RADIUS_PX, type AnatomyView } from './anatomy'
import type { BodyValues } from './fills'

export type ChooserState = {
  view: AnatomyView
  /** Subject side that was tapped; candidates are outlined on that side only. */
  side: 'l' | 'r'
  /** At most 4, most covered first. */
  groups: string[]
  /** Tap point relative to the map container, px. */
  x: number
  y: number
}

const WIDTH = 208
const OFFSET = 18
const SIDE = 22
const EDGE = 4

/** "Which muscle?" list shown when a tap lands between groups. */
export function MuscleChooser({
  state,
  values,
  scale,
  container,
  onPick,
  onClose,
}: {
  state: ChooserState
  values: BodyValues
  scale: MapScale
  container: RefObject<HTMLDivElement | null>
  onPick: (group: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    const box = container.current
    if (!el || !box) return
    const w = box.clientWidth
    const h = el.offsetHeight
    const clampTop = (t: number) => Math.max(EDGE, Math.min(box.clientHeight - h - EDGE, t))
    // Beside the tap keeps the outlined candidates visible; fall back to below or above it.
    let left: number
    let top: number
    if (state.x + SIDE + WIDTH <= w - EDGE) {
      left = state.x + SIDE
      top = clampTop(state.y - h / 2)
    } else if (state.x - SIDE - WIDTH >= EDGE) {
      left = state.x - SIDE - WIDTH
      top = clampTop(state.y - h / 2)
    } else {
      left = Math.max(EDGE, Math.min(w - WIDTH - EDGE, state.x - WIDTH / 2))
      const above = state.y - OFFSET - h
      top = state.y < box.clientHeight * 0.55 || above < 0 ? state.y + OFFSET : above
    }
    setPos({ left, top })
  }, [state, container])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) {
        // A tap on the map itself re-runs hit-testing; anything else just closes.
        if (!(e.target instanceof Element && e.target.closest('svg[data-bodymap]'))) onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute z-10 rounded-full border-2 border-ink bg-ink/10"
        style={{ left: state.x - TAP_RADIUS_PX, top: state.y - TAP_RADIUS_PX, width: TAP_RADIUS_PX * 2, height: TAP_RADIUS_PX * 2 }}
      />
      <div
        ref={ref}
        role="dialog"
        aria-label="Which muscle?"
        className="absolute z-20 rounded-lg border border-line bg-raised p-1 shadow-float transition-opacity duration-150"
        style={{ width: WIDTH, left: pos?.left ?? 0, top: pos?.top ?? 0, opacity: pos ? 1 : 0 }}
      >
        <p className="px-3 pb-1 pt-2 text-xs font-medium text-ink-2">Which muscle?</p>
        <ul>
          {state.groups.map((g) => {
            const known = values.groups[g] !== undefined
            const sets = values.groups[g] ?? 0
            return (
              <li key={g}>
                <button
                  type="button"
                  onClick={() => onPick(g)}
                  className="flex h-12 w-full items-center gap-3 rounded-md px-3 text-left text-base text-ink hover:bg-surface-2 active:bg-surface-2"
                >
                  <span
                    className="size-3 shrink-0 rounded-full ring-1 ring-line-strong ring-inset"
                    style={{ background: VOLUME_COLOR[groupShade(g, sets, scale)] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{getGroup(g)?.name ?? g}</span>
                  {known && <span className="num text-sm text-ink-2">{formatSets(sets)}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}

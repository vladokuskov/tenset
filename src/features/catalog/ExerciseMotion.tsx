import { Pause, Play } from 'lucide-react'
import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type { Exercise } from '../../domain/schema'
import { MotionClock } from '../figure/motion/clock'
import type { MotionExercise, MotionScene, ViewPreset } from '../figure/motion/compose'
import { loadMotionFile, type MotionFile } from '../figure/motion/library'
import { IconButton, SegmentedControl } from '../../ui'
import { cx } from '../../ui/cx'
import { ExerciseCardMedia } from './ExerciseCardMedia'
import { showsMotion } from './media'
import { useRoles } from './useRoles'

const MotionStage = lazy(() => import('../figure/motion/MotionStage'))

/** one fixed well colour in both themes, as the baked loops will use */
const WELL = '#f6f6f4'

const VIEWS: { value: ViewPreset; label: string }[] = [
  { value: 'hero', label: 'Default' },
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'back', label: 'Back' },
]

/** A 3D failure (no WebGL, model offline) leaves the card in place instead of breaking the page. */
class Fallback extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** degrees of turn per pixel of horizontal drag */
const DRAG_RATE = 0.45
const DRAG_START = 6

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Detail media: the live figure when the exercise has a baked loop it may show (see showsMotion), otherwise the M1 card. */
export function ExerciseMedia({ exercise }: { exercise: Exercise }) {
  return showsMotion(exercise) ? <ExerciseMotion exercise={exercise} /> : <ExerciseCardMedia exercise={exercise} size="lg" />
}

/**
 * Live 3D figure for exercises with a baked loop. The M1 card shows while the 3D chunk and the loop load, then
 * crossfades out. Presets and a horizontal drag turn the camera; the page keeps scrolling vertically (touch-action
 * pan-y, no orbit controls). Reduced motion starts paused in the middle of the lift.
 */
export function ExerciseMotion({ exercise }: { exercise: Exercise }) {
  const roles = useRoles(exercise)
  const reduced = useMemo(() => prefersReducedMotion(), [])
  const clock = useMemo(() => new MotionClock(0, !reduced, !reduced), [reduced])
  const [file, setFile] = useState<MotionFile | null>(null)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<ViewPreset>('hero')
  const [yaw, setYaw] = useState(0)
  const [playing, setPlaying] = useState(!reduced)
  const [slow, setSlow] = useState(false)
  const [phase, setPhase] = useState(0)
  const drag = useRef<{ id: number; x: number; yaw: number; active: boolean } | null>(null)

  useEffect(() => {
    let stale = false
    loadMotionFile(exercise.id).then((f) => !stale && setFile(f), () => !stale && setFailed(true))
    return () => {
      stale = true
    }
  }, [exercise.id])

  const target: MotionExercise = useMemo(() => ({ ...exercise, groups: roles }), [exercise, roles])

  const onReady = useCallback((scene: MotionScene) => {
    if (reduced) clock.seek(scene.midRep)
    setPhase(clock.phase)
    setReady(true)
  }, [clock, reduced])

  const onError = useCallback(() => {
    setFailed(true)
    setReady(false)
  }, [])

  // the scrubber follows playback without re-rendering the canvas
  useEffect(() => {
    if (!ready || !playing) return
    let raf = 0
    const step = () => {
      setPhase(clock.phase)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [ready, playing, clock])

  const togglePlay = () => {
    clock.play(!playing)
    setPlaying(!playing)
  }
  const toggleSpeed = () => {
    clock.setSpeed(slow ? 1 : 0.5)
    setSlow(!slow)
  }
  const scrub = (v: number) => {
    clock.play(false)
    setPlaying(false)
    clock.seek(v)
    setPhase(clock.phase)
  }
  const pickView = (v: ViewPreset) => {
    setView(v)
    setYaw(0)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { id: e.pointerId, x: e.clientX, yaw, active: false }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    if (!d.active && Math.abs(dx) > DRAG_START) {
      d.active = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (d.active) setYaw(d.yaw - dx * DRAG_RATE)
  }
  const endDrag = () => {
    drag.current = null
  }

  const name = `${exercise.name}: animated figure with the worked muscles highlighted, primary in red, secondary in orange.`
  return (
    <div>
      <div className="relative aspect-[5/4] overflow-hidden rounded-xl" style={{ background: WELL }}>
        {!failed && file && (
          <div
            role="img"
            aria-label={name}
            className={cx('absolute inset-0 cursor-grab touch-pan-y transition-opacity duration-500 active:cursor-grabbing', ready ? 'opacity-100' : 'opacity-0')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <Fallback onError={onError}>
              <Suspense fallback={null}>
                <MotionStage exercise={target} motion={file.motion} clock={clock} view={view} yaw={yaw} onReady={onReady} />
              </Suspense>
            </Fallback>
          </div>
        )}
        <div className={cx('pointer-events-none absolute inset-0 transition-opacity duration-500', ready && 'opacity-0')} aria-hidden={ready}>
          <ExerciseCardMedia exercise={exercise} size="lg" className="size-full !rounded-none" />
        </div>
      </div>
      {!failed && (
        <div className="mt-2 flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <IconButton icon={playing ? Pause : Play} label={playing ? 'Pause' : 'Play'} onClick={togglePlay} disabled={!ready} />
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(phase * 1000)}
              onChange={(e) => scrub(Number(e.target.value) / 1000)}
              disabled={!ready}
              aria-label="Position in the rep"
              className="h-11 min-w-0 flex-1 cursor-pointer accent-ink disabled:opacity-40"
            />
            <button
              type="button"
              onClick={toggleSpeed}
              disabled={!ready}
              aria-label={slow ? 'Playing at half speed, switch to normal speed' : 'Playing at normal speed, switch to half speed'}
              className="hit num h-9 w-12 shrink-0 rounded-md bg-surface-2 text-sm font-medium text-ink disabled:opacity-40"
            >
              {slow ? '0.5x' : '1x'}
            </button>
          </div>
          <SegmentedControl label="Camera" options={VIEWS} value={view} onChange={pickView} size="sm" block />
        </div>
      )}
    </div>
  )
}

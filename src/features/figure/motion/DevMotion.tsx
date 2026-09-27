import { useCallback, useEffect, useMemo, useState } from 'react'
import { catalog } from '../../../data/catalog'
import type { Baked, CompactMotion } from '../../../motion/bake.ts'
import { MotionClock } from './clock'
import type { ViewPreset } from './compose'
import { loadMotionFile, motionIds } from './library'
import MotionStage from './MotionStage'
import { motionSkeleton } from './skeleton'

declare global {
  interface Window {
    __ready?: boolean
    /** pause and show loop fraction t (0..1); resolves once that frame is on screen */
    renderAt?: (t: number) => Promise<void>
  }
}

type Props = {
  id: number
  /** loop fraction to hold (pauses playback) */
  t?: number
  paused?: boolean
  view?: ViewPreset
  yaw?: number
  /** bake in the browser from the current templates instead of loading the shipped file */
  live?: boolean
  focus?: { bone: string; size: number }
}

const frames = (n: number) => new Promise<void>((done) => {
  const step = (k: number) => (k ? requestAnimationFrame(() => step(k - 1)) : done())
  step(n)
})

async function bakeLive(id: number): Promise<Baked> {
  const ex = catalog.get(id)
  if (!ex?.media.template) throw new Error(`exercise ${id} has no motion template`)
  const [{ bake }, { getTemplate, parseParams }] = await Promise.all([import('../../../motion/bake.ts'), import('../../../motion/templates/index.ts')])
  const params = parseParams(ex.media.template, ex.media.params, ex.laterality)
  return bake(getTemplate(ex.media.template), params, motionSkeleton())
}

/** Dev inspection page for one exercise's live figure (/dev/motion?id=711&t=0.4&view=side). */
export default function DevMotion({ id, t, paused, view = 'hero', yaw = 0, live = false, focus }: Props) {
  const exercise = catalog.get(id)
  const [motion, setMotion] = useState<CompactMotion | Baked | null>(null)
  const [error, setError] = useState<string | null>(null)
  const clock = useMemo(() => new MotionClock(t ?? 0, !paused && t === undefined), [t, paused])

  useEffect(() => {
    window.__ready = false
    let stale = false
    ;(live ? bakeLive(id) : loadMotionFile(id).then((f) => f.motion))
      .then((m) => !stale && setMotion(m))
      .catch((e: Error) => !stale && setError(e.message))
    return () => {
      stale = true
    }
  }, [id, live])

  useEffect(() => {
    window.renderAt = async (u: number) => {
      clock.play(false)
      clock.seek(u)
      await frames(3)
    }
    return () => {
      delete window.renderAt
    }
  }, [clock])

  const onReady = useCallback(() => {
    void frames(2).then(() => (window.__ready = true))
  }, [])

  if (!exercise || error) {
    return <pre className="p-4 text-sm">{error ?? `unknown exercise ${id}`}{`\nexercises with motion: ${motionIds.join(', ')}`}</pre>
  }
  return (
    <div className="fixed inset-0" style={{ background: '#ffffff' }}>
      {motion && (
        <MotionStage
          exercise={exercise}
          motion={motion}
          clock={clock}
          view={view}
          yaw={yaw}
          snap
          focus={focus}
          dpr={Math.min(window.devicePixelRatio || 1, 3)}
          onReady={onReady}
        />
      )}
    </div>
  )
}

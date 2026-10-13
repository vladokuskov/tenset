import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { cx } from '../../ui/cx'
import { BodyMini, useAnatomy, type AnatomyView, type BodyMiniProps } from '../bodymap'
import { prefersReducedMotion, pulseStore } from '../shared/pulse'

export type PulseMiniProps = BodyMiniProps & {
  /** Which scope this map shows, so it only pulses for changes it displays. */
  pulseScope: 'week' | number
}

function Overlay({ view, groups, pulseKey }: { view: AnatomyView; groups: readonly string[]; pulseKey: number }) {
  const doc = useAnatomy(view, 'groups')
  const ref = useRef<SVGGElement>(null)
  const show = groups.length > 0 && pulseKey > 0

  useEffect(() => {
    const g = ref.current
    if (!show || !g || prefersReducedMotion() || typeof g.animate !== 'function') return
    const anim = g.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.3 }, { opacity: 0 }], {
      duration: 1000,
      easing: 'ease-out',
    })
    return () => anim.cancel()
  }, [show, pulseKey, doc])

  if (!doc || !show) return null
  return (
    <svg viewBox={doc.viewBox} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <g ref={ref} opacity={0}>
        {doc.regions
          .filter((r) => r.group && groups.includes(r.group))
          .map((r, i) => (
            <path key={i} d={r.d} fillRule={r.evenodd ? 'evenodd' : undefined} fill="var(--color-ink)" />
          ))}
      </g>
    </svg>
  )
}

/** BodyMini that pulses the regions changed by the last program edit, once. */
export function PulseMini({ pulseScope, view, label, className, height = 72, ...rest }: PulseMiniProps) {
  const pulse = useStore(pulseStore, (s) => s.current)
  const [seen] = useState(() => pulse?.key ?? 0)
  const fresh = pulse && pulse.key > seen ? pulse : null
  const groups = fresh ? (pulseScope === 'week' ? fresh.week : (fresh.days[pulseScope] ?? [])) : []
  const views: AnatomyView[] = view === 'both' ? ['front', 'back'] : [view]

  return (
    <div
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx('inline-flex shrink-0 items-center', className)}
      style={{ gap: Math.round(height * 0.1) }}
    >
      {views.map((v) => (
        <div key={v} className="relative">
          <BodyMini view={v} height={height} {...rest} />
          <Overlay view={v} groups={groups} pulseKey={fresh?.key ?? 0} />
        </div>
      ))}
    </div>
  )
}

import { useMemo } from 'react'
import type { Role } from '../../domain/schema'
import type { MapScale } from '../../app/volumeScale'
import { usePrefsStore } from '../../store/prefs.store'
import { cx } from '../../ui/cx'
import { MAP_ASPECT, type AnatomyView } from './anatomy'
import { AnatomyFigure } from './AnatomyFigure'
import { miniVars } from './fills'

export type BodyMiniProps = {
  view: 'front' | 'back' | 'both'
  /** Fractional sets per group, shaded on the volume scale. */
  groups?: Readonly<Record<string, number>>
  /** Primary/secondary tint (exercise cards). Takes precedence over `groups`. */
  roles?: Readonly<Record<string, Role>>
  scale?: MapScale
  /** Figure height in px. */
  height?: number
  /** When set the map is announced as an image with this name; otherwise it is decorative. */
  label?: string
  className?: string
}

/** Small group-level map for day rows, cards and chips. Every instance shares one <symbol>. */
export function BodyMini({ view, groups, roles, scale = 'week', height = 72, label, className }: BodyMiniProps) {
  const views: AnatomyView[] = view === 'both' ? ['front', 'back'] : [view]
  const targets = usePrefsStore((s) => s.targets)
  const vars = useMemo(() => miniVars(groups, roles, scale, targets), [groups, roles, scale, targets])
  return (
    <div
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx('inline-flex shrink-0 items-center gap-[6%]', className)}
    >
      {views.map((v) => (
        <AnatomyFigure
          key={v}
          view={v}
          kind="groups"
          vars={vars}
          className="block shrink-0"
          style={{ height, width: Math.round(height * MAP_ASPECT) }}
        />
      ))}
    </div>
  )
}

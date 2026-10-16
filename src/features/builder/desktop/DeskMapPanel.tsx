import { Link, useNavigate } from '@tanstack/react-router'
import { NotMedicalAdvice } from '../../../app/brand'
import { formatSets } from '../../../app/format'
import type { WeekView } from '../../../app/useWeek'
import { groupName } from '../../../data/localize'
import { useLocale } from '../../../i18n/messages'
import { cx, MovementMix } from '../../../ui'
import { useMediaQuery } from '../../../ui/useMediaQuery'
import { BodyMap, VolumeLegend } from '../../bodymap'
import { CoverageCard } from '../CoverageCard'
import { trainedGroups, type Focus, type LitEntry } from './coupling'
import { desktopMessages } from './messages'

export type DeskMapPanelProps = {
  view: WeekView
  focus: Focus | null
  /** Entries that train the focused group. */
  lit: readonly LitEntry[]
  onFocusGroup: (group: string | null) => void
  /** Inline panel shows its own title; the overlay sheet already has one. */
  title?: boolean
}

function Status({ view, focus, lit }: Pick<DeskMapPanelProps, 'view' | 'focus' | 'lit'>) {
  // Tablets in landscape get the board too, without hover.
  const hover = useMediaQuery('(hover: hover)')
  const locale = useLocale()
  const m = desktopMessages[locale]
  if (focus?.kind !== 'group') return <span className="text-ink-3">{hover ? m.hoverMuscle : m.tapMuscle}</span>
  const sets = view.week.weekly[focus.group] ?? 0
  return (
    <span className="num">
      <span className="font-medium text-ink">{groupName(focus.group, locale)}</span>{' '}
      {sets > 0 ? m.groupStatus(sets, lit.length) : m.notTrained}
    </span>
  )
}

/** Week map with two-way coupling: a hovered or focused muscle lights the board entries that train it. */
export function DeskMapPanel({ view, focus, lit, onFocusGroup, title = true }: DeskMapPanelProps) {
  const navigate = useNavigate()
  const locale = useLocale()
  const m = desktopMessages[locale]
  const { week } = view
  const highlight = focus ? (focus.kind === 'entry' ? focus.groups : [focus.group]) : undefined
  const trained = trainedGroups(week.weekly)
  const current = focus?.kind === 'group' ? focus.group : null

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-surface p-4">
        <div className="flex min-h-6 items-baseline justify-between gap-3">
          {title && <h2 className="shrink-0 text-md font-semibold">{m.thisWeek}</h2>}
          <p className="min-w-0 truncate text-sm text-ink-2" data-map-status>
            <Status view={view} focus={focus} lit={lit} />
          </p>
        </div>
        <div data-desk-map={highlight?.join(' ') ?? ''}>
          <BodyMap
            className="mx-auto mt-3 max-w-[22rem]"
            view="both"
            values={{ groups: week.weekly, heads: week.shade.weekly }}
            scale="week"
            highlight={highlight}
            onSelectGroup={(group) => void navigate({ to: '/body', search: { sheet: 'muscle', group } })}
            onHoverGroup={onFocusGroup}
            label={m.mapLabel}
          />
        </div>
        <VolumeLegend scale="week" className="mt-4" />
        {trained.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="text-xs font-medium text-ink-3">{m.trainedThisWeek}</h3>
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={m.trainedThisWeek}>
              {trained.map((g) => (
                <li key={g}>
                  <Link
                    to="/body"
                    search={{ sheet: 'muscle', group: g }}
                    onPointerEnter={() => onFocusGroup(g)}
                    onPointerLeave={() => onFocusGroup(null)}
                    onFocus={() => onFocusGroup(g)}
                    onBlur={() => onFocusGroup(null)}
                    className={cx(
                      'hit inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors',
                      current === g ? 'border-ink bg-ink text-on-ink' : 'border-line-strong text-ink hover:bg-surface-2',
                    )}
                  >
                    {groupName(g, locale)}
                    <span className={cx('num', current === g ? 'text-on-ink/70' : 'text-ink-3')}>
                      {formatSets(week.weekly[g], locale)}
                      <span className="sr-only">{m.setsSr(week.weekly[g])}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <section className="rounded-xl bg-surface p-4" data-desk-mix>
        <h3 className="text-sm font-semibold">{m.byMovement}</h3>
        <MovementMix mix={view.mix} size="big" legend className="mt-3" />
      </section>
      <CoverageCard view={view} compact />
      <p className="px-1 text-xs text-ink-3"><NotMedicalAdvice /></p>
    </div>
  )
}

import { Link, useNavigate } from '@tanstack/react-router'
import { NOT_MEDICAL_ADVICE } from '../../../app/brand'
import { countLabel, formatSets, plural } from '../../../app/format'
import type { WeekView } from '../../../app/useWeek'
import { cx } from '../../../ui'
import { BodyMap, VolumeLegend } from '../../bodymap'
import { CoverageCard } from '../CoverageCard'
import { groupName } from '../labels'
import { useMediaQuery } from '../useMediaQuery'
import { trainedGroups, type Focus, type LitEntry } from './coupling'

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
  if (focus?.kind !== 'group') return <span className="text-ink-3">{hover ? 'Hover a muscle' : 'Tap a muscle for details'}</span>
  const sets = view.week.weekly[focus.group] ?? 0
  return (
    <span className="num">
      <span className="font-medium text-ink">{groupName(focus.group)}</span>{' '}
      {sets > 0 ? `${formatSets(sets)} ${plural(sets, 'set')} · ${countLabel(lit.length, 'exercise')}` : 'not trained'}
    </span>
  )
}

/** Week map with two-way coupling: a hovered or focused muscle lights the board entries that train it. */
export function DeskMapPanel({ view, focus, lit, onFocusGroup, title = true }: DeskMapPanelProps) {
  const navigate = useNavigate()
  const { week } = view
  const highlight = focus ? (focus.kind === 'entry' ? focus.groups : [focus.group]) : undefined
  const trained = trainedGroups(week.weekly)
  const current = focus?.kind === 'group' ? focus.group : null

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-surface p-4">
        <div className="flex min-h-6 items-baseline justify-between gap-3">
          {title && <h2 className="shrink-0 text-md font-semibold">This week</h2>}
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
            label="Weekly volume by muscle"
          />
        </div>
        <VolumeLegend scale="week" className="mt-4" />
        {trained.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="text-xs font-medium text-ink-3">Trained this week</h3>
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Trained this week">
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
                    {groupName(g)}
                    <span className={cx('num', current === g ? 'text-on-ink/70' : 'text-ink-3')}>
                      {formatSets(week.weekly[g])}
                      <span className="sr-only"> sets</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <CoverageCard view={view} compact />
      <p className="px-1 text-xs text-ink-3">{NOT_MEDICAL_ADVICE}</p>
    </div>
  )
}

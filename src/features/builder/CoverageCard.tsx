import { Link } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { formatSets } from '../../app/format'
import { gapNote } from '../../app/knownGaps'
import type { WeekView } from '../../app/useWeek'
import { bandCounts } from '../../domain/bandCounts'
import { useLocale } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { cx } from '../../ui'
import { groupName } from './labels'
import { builderMessages } from './messages'
import { PulseMini } from './PulseMini'

const chip =
  'hit inline-flex h-8 items-center rounded-full border border-line-strong px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2'

/** Week coverage: mini map, band counts (tap for the groups below range), not-trained chips (to the muscle sheet), total sets. */
export function CoverageCard({ view, compact }: { view: WeekView; compact?: boolean }) {
  const [showOptional, setShowOptional] = useState(false)
  const [showBelow, setShowBelow] = useState(false)
  const locale = useLocale()
  const m = builderMessages[locale]
  const gaps = gapNote(usePrefsStore((s) => s.equipment))
  const { coverage, days, week } = view
  const totalSets = days.reduce((s, d) => s + d.hardSets, 0)
  const { required, optional } = coverage.untrained
  const bands = bandCounts(week)
  const inRange = m.bandInRange(bands.inTarget, bands.total)
  const outside = m.bandOutside(bands.below.length, bands.above)
  const headline = (
    <>
      <span className="block text-lg font-medium leading-snug text-ink">{inRange}</span>
      <span className="sr-only"> · </span>
      <span className="mt-0.5 flex items-center gap-1 text-base text-ink-2">
        {outside}
        {bands.below.length > 0 && (
          <ChevronDown size={16} strokeWidth={2} aria-hidden className={cx('text-ink-3 transition-transform', showBelow && 'rotate-180')} />
        )}
      </span>
    </>
  )

  return (
    <section className="@container rounded-xl bg-surface p-4" aria-label={m.weekCoverage}>
      <div className="flex items-center gap-4">
        {!compact && (
          <PulseMini view="both" groups={week.weekly} height={112} pulseScope="week" label={m.weekCoverageMap} className="@max-xs:hidden" />
        )}
        <div className="min-w-0">
          {bands.below.length > 0 ? (
            <button
              type="button"
              aria-expanded={showBelow}
              onClick={() => setShowBelow(!showBelow)}
              className="hit num block text-left"
            >
              {headline}
            </button>
          ) : (
            <p className="num">
              {bands.total > 0 ? headline : <span className="text-lg font-medium text-ink">{m.groupsOf(coverage.trainedBanded, coverage.totalBanded)}</span>}
            </p>
          )}
          <p className="num mt-2 text-sm text-ink-2">{m.hardSetsThisWeek(totalSets)}</p>
          <p className="num mt-0.5 text-sm text-ink-3">{m.groupsOf(coverage.trainedBanded, coverage.totalBanded)}</p>
        </div>
      </div>

      {showBelow && bands.below.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="text-xs font-medium text-ink-3">{m.belowTarget}</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {bands.below.map((g) => (
              <li key={g}>
                <Link to="/body" search={{ sheet: 'muscle', group: g }} className={cx(chip, 'gap-1.5')}>
                  {groupName(g, locale)}
                  <span className="num font-normal text-ink-2">{formatSets(week.weekly[g] ?? 0, locale)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(required.length > 0 || optional.length > 0) && (
        <div className="mt-4 border-t border-line pt-3">
          {required.length > 0 && (
            <>
              <h3 className="text-xs font-medium text-ink-3">{m.notTrainedYet}</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {required.map((u) => (
                  <li key={u.group}>
                    <Link to="/body" search={{ sheet: 'muscle', group: u.group }} className={chip}>
                      {groupName(u.group, locale)}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {optional.length > 0 && (
            <div className={cx(required.length > 0 && 'mt-3')}>
              <button
                type="button"
                aria-expanded={showOptional}
                onClick={() => setShowOptional(!showOptional)}
                className="hit text-sm text-ink-2 underline-offset-4 hover:underline"
              >
                {m.optionalAtZero(optional.length)}
              </button>
              {showOptional && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {optional.map((u) => (
                    <li key={u.group}>
                      <Link to="/body" search={{ sheet: 'muscle', group: u.group }} className={cx(chip, 'text-ink-2')}>
                        {groupName(u.group, locale)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {gaps && <p className="mt-3 border-t border-line pt-3 text-sm text-ink-2">{gaps}</p>}
    </section>
  )
}

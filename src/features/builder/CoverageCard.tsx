import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { gapNote } from '../../app/knownGaps'
import type { WeekView } from '../../app/useWeek'
import { useLocale } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { cx } from '../../ui'
import { groupName } from './labels'
import { builderMessages } from './messages'
import { PulseMini } from './PulseMini'

const chip =
  'hit inline-flex h-8 items-center rounded-full border border-line-strong px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2'

/** Week coverage: mini map, trained count, not-trained chips (to the muscle sheet), total sets. */
export function CoverageCard({ view, compact }: { view: WeekView; compact?: boolean }) {
  const [showOptional, setShowOptional] = useState(false)
  const locale = useLocale()
  const m = builderMessages[locale]
  const gaps = gapNote(usePrefsStore((s) => s.equipment))
  const { coverage, days, week } = view
  const totalSets = days.reduce((s, d) => s + d.hardSets, 0)
  const { required, optional } = coverage.untrained

  return (
    <section className="rounded-xl bg-surface p-4" aria-label={m.weekCoverage}>
      <div className="flex items-center gap-4">
        {!compact && (
          <PulseMini view="both" groups={week.weekly} height={112} pulseScope="week" label={m.weekCoverageMap} />
        )}
        <div className="min-w-0">
          <p className="num">
            <span className="text-display font-light">{coverage.trainedBanded}</span>
            <span className="text-lg text-ink-3">{m.ofTotal(coverage.totalBanded)}</span>
          </p>
          <p className="mt-1 text-sm text-ink-2">{m.groupsTrained}</p>
          <p className="num mt-3 text-sm text-ink-2">
            {m.hardSetsThisWeek(totalSets)}
          </p>
        </div>
      </div>

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

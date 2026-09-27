import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { formatSets, plural } from '../../app/format'
import type { WeekView } from '../../app/useWeek'
import { cx } from '../../ui'
import { groupName } from './labels'
import { PulseMini } from './PulseMini'

const chip =
  'hit inline-flex h-8 items-center rounded-full border border-line-strong px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2'

/** Week coverage: mini map, trained count, not-trained chips (to the muscle sheet), total sets. */
export function CoverageCard({ view, compact }: { view: WeekView; compact?: boolean }) {
  const [showOptional, setShowOptional] = useState(false)
  const { coverage, days, week } = view
  const totalSets = days.reduce((s, d) => s + d.hardSets, 0)
  const { required, optional } = coverage.untrained

  return (
    <section className="rounded-xl bg-surface p-4" aria-label="Week coverage">
      <div className="flex items-center gap-4">
        {!compact && (
          <PulseMini view="both" groups={week.weekly} height={112} pulseScope="week" label="Week coverage, front and back" />
        )}
        <div className="min-w-0">
          <p className="num">
            <span className="text-display font-light">{coverage.trainedBanded}</span>
            <span className="text-lg text-ink-3"> of {coverage.totalBanded}</span>
          </p>
          <p className="mt-1 text-sm text-ink-2">groups trained</p>
          <p className="num mt-3 text-sm text-ink-2">
            {formatSets(totalSets)} hard {plural(totalSets, 'set')} this week
          </p>
        </div>
      </div>

      {(required.length > 0 || optional.length > 0) && (
        <div className="mt-4 border-t border-line pt-3">
          {required.length > 0 && (
            <>
              <h3 className="text-xs font-medium text-ink-3">Not trained yet</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {required.map((u) => (
                  <li key={u.group}>
                    <Link to="/body" search={{ sheet: 'muscle', group: u.group }} className={chip}>
                      {groupName(u.group)}
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
                {optional.length} optional {plural(optional.length, 'group')} at 0 sets
              </button>
              {showOptional && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {optional.map((u) => (
                    <li key={u.group}>
                      <Link to="/body" search={{ sheet: 'muscle', group: u.group }} className={cx(chip, 'text-ink-2')}>
                        {groupName(u.group)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

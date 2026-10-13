import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { dayName, daySlug, todayIndex } from '../../app/days'
import { formatDaySummary } from '../../app/format'
import type { WeekView } from '../../app/useWeek'
import { groupName } from '../../data/localize'
import { useLocale, useMessages } from '../../i18n/messages'
import { cx } from '../../ui'
import { builderMessages } from './messages'
import { PulseMini } from './PulseMini'

/** Seven day rows in display order; rest rows are compact. */
export function WeekList({ view }: { view: WeekView }) {
  const { order, days, week } = view
  const today = todayIndex()
  const locale = useLocale()
  const m = useMessages(builderMessages)
  return (
    <ul className="@container divide-y divide-line rounded-xl bg-surface" aria-label={m.week}>
      {order.map((d) => {
        const s = days[d]
        const rest = s.kind === 'rest'
        const groups = Object.fromEntries(Object.entries(week.daily).map(([g, v]) => [g, v[d]]))
        return (
          <li key={d}>
            <Link
              to="/day/$dow"
              params={{ dow: daySlug(d) }}
              className={cx('flex items-center gap-3 px-4', rest ? 'min-h-12 py-1.5' : 'min-h-[4.75rem] py-2.5')}
            >
              <span className={cx('w-[3.25rem] shrink-0 text-base font-semibold', rest && 'font-medium text-ink-3')}>
                {dayName(d, 'short', locale)}
                {d === today && <span className="block text-[0.6875rem] font-normal text-ink-3">{m.today}</span>}
              </span>
              <span className="min-w-0 flex-1">
                {rest ? (
                  <span className="block truncate text-base text-ink-3">{m.rest}</span>
                ) : (
                  <>
                    <span className="line-clamp-2 break-words text-base">{s.label ?? m.training}</span>
                    <span className="num block text-sm text-ink-2">{formatDaySummary(s.exercises, s.hardSets, locale, s.estMinutes)}</span>
                    {s.topGroups.length > 0 && (
                      <span className="line-clamp-2 text-xs text-ink-3">{s.topGroups.map((g) => groupName(g, locale)).join(', ')}</span>
                    )}
                  </>
                )}
              </span>
              {!rest && s.exercises > 0 && <PulseMini view="both" groups={groups} scale="day" height={46} pulseScope={d} className="@max-xs:hidden" />}
              <ChevronRight size={20} className="shrink-0 text-ink-3" aria-hidden />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

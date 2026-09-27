import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { dayName, type DayIndex } from '../../app/days'
import { formatSets, plural } from '../../app/format'
import type { WeekView } from '../../app/useWeek'
import { isBanded } from '../../domain/taxonomy'
import { cx } from '../../ui'
import { groupName } from './labels'
import { PulseMini } from './PulseMini'
import { readFlag, writeFlag } from './useMediaQuery'

const OPEN_KEY = 'gb:ui:this-day-open'
// One recovery line by default keeps the entry list above the fold on a phone.
const FACTS_SHOWN = 1

/** Collapsible summary of one day: day-scale map, top groups and plain recovery facts. */
export function ThisDayCard({ view, day }: { view: WeekView; day: DayIndex }) {
  const [open, setOpen] = useState(() => readFlag(OPEN_KEY, true))
  const [allFacts, setAllFacts] = useState(false)
  const bodyId = useId()
  const { week } = view
  const groups = Object.fromEntries(Object.entries(week.daily).map(([g, v]) => [g, v[day]]))
  const top = Object.entries(groups)
    .filter(([g, v]) => v > 0 && isBanded(g))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
  const facts = view.dayFacts(day).filter((f) => isBanded(f.group))
  const visibleFacts = allFacts ? facts : facts.slice(0, FACTS_SHOWN)

  const toggle = () => {
    setOpen(!open)
    writeFlag(OPEN_KEY, !open)
  }

  return (
    <section className="rounded-xl bg-surface" aria-label="This day">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
        className="flex min-h-12 w-full items-center gap-3 px-4 text-left"
      >
        <span className="flex-1 text-base font-semibold">This day</span>
        {!open && top.length > 0 && (
          <span className="num truncate text-sm text-ink-2">{top.slice(0, 2).map(([g]) => groupName(g)).join(', ')}</span>
        )}
        <ChevronDown size={18} strokeWidth={1.75} aria-hidden className={cx('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div id={bodyId} className="flex gap-4 px-4 pb-4">
          <PulseMini view="both" groups={groups} scale="day" height={104} pulseScope={day} label={`Muscles trained on ${dayName(day, 'long')}`} className="self-start" />
          <div className="min-w-0 flex-1">
            {top.length === 0 ? (
              <p className="text-sm text-ink-2">No sets counted on this day yet.</p>
            ) : (
              <>
                <h3 className="text-xs font-medium text-ink-3">Most sets</h3>
                <ul className="mt-1 space-y-0.5">
                  {top.map(([g, v]) => (
                    <li key={g} className="num flex justify-between gap-2 text-sm">
                      <span className="truncate">{groupName(g)}</span>
                      <span className="text-ink-2">{formatSets(v)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {facts.length > 0 && (
              <>
                <h3 className="mt-3 text-xs font-medium text-ink-3">Earlier sessions</h3>
                <ul className="mt-1 space-y-1">
                  {visibleFacts.map((f) => (
                    <li key={f.group} className="num text-sm leading-snug text-ink-2">
                      {groupName(f.group)}: also {dayName(f.previousDay)}, {f.daysEarlier} {plural(f.daysEarlier, 'day')} earlier,{' '}
                      {formatSets(f.sets)} {plural(f.sets, 'set')}
                    </li>
                  ))}
                </ul>
                {facts.length > FACTS_SHOWN && (
                  <button type="button" onClick={() => setAllFacts(!allFacts)} className="hit mt-1 text-sm font-medium text-accent">
                    {allFacts ? 'Show fewer' : `Show ${facts.length - FACTS_SHOWN} more`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

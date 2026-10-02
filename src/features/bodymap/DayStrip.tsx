import { dayName, type DayIndex } from '../../app/days'
import { formatSets } from '../../app/format'
import { groupShade, VOLUME_COLOR } from '../../app/volumeScale'
import { useLocale } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { cx } from '../../ui/cx'
import { bodymapMessages } from './messages'

const BAR_PX = 56

/** Mon..Sun bars of one group's sets per day, in display order. Plain information, no severity. */
export function DayStrip({
  group,
  daily,
  order,
  selectedDay,
  caption,
}: {
  group: string
  daily: readonly number[]
  order: readonly DayIndex[]
  selectedDay?: DayIndex | null
  caption: string
}) {
  const locale = useLocale()
  const targets = usePrefsStore((s) => s.targets)
  const max = Math.max(4, ...daily)
  const summary = order.map((d) => `${dayName(d, 'long', locale)} ${formatSets(daily[d] ?? 0, locale)}`).join(', ')
  return (
    <div>
      <div role="img" aria-label={bodymapMessages[locale].setsPerDay(summary)} className="grid grid-cols-7 gap-1.5">
        {order.map((d) => {
          const v = daily[d] ?? 0
          const selected = selectedDay === d
          return (
            <div key={d} className="flex min-w-0 flex-col items-center">
              <span className="num mb-1 h-4 text-xs leading-4 text-ink-2">{v > 0 ? formatSets(v, locale) : ''}</span>
              <div className="flex w-full items-end justify-center" style={{ height: BAR_PX }}>
                {v > 0 ? (
                  <span
                    className="block w-full max-w-9 rounded-t-[6px] rounded-b-[2px]"
                    style={{
                      height: Math.max(6, Math.round((v / max) * BAR_PX)),
                      background: VOLUME_COLOR[groupShade(group, v, 'day', targets)],
                    }}
                  />
                ) : (
                  <span className="block h-0.5 w-full max-w-9 rounded-full bg-line-strong" />
                )}
              </div>
              <span
                className={cx(
                  'mt-1.5 rounded-full px-1.5 text-xs leading-5',
                  selected ? 'bg-ink font-semibold text-on-ink' : v > 0 ? 'font-medium text-ink' : 'text-ink-3',
                )}
              >
                {dayName(d, 'short', locale)}
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-sm text-ink-2">{caption}</p>
    </div>
  )
}

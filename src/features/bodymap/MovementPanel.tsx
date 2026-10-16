import { formatSets } from '../../app/format'
import { common } from '../../i18n/common'
import { useLocale } from '../../i18n/messages'
import { cx, movementLabel, mvBg, Panel, Section } from '../../ui'
import { bodymapMessages } from './messages'
import type { MovementRow } from './movement'

/** Hard sets per movement group with a bar scaled to the biggest group. Movement colors never reach the map. */
export function MovementPanel({ rows }: { rows: MovementRow[] }) {
  const locale = useLocale()
  const m = bodymapMessages[locale]
  const total = rows.reduce((s, r) => s + r.sets, 0)
  const max = Math.max(1, ...rows.map((r) => r.sets))
  return (
    <Section title={m.byMovement} description={m.movementDescription(total)}>
      <Panel as="ul" className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 px-4 py-2.5">
            <span aria-hidden className={cx('size-7 rounded-[0.5625rem] ring-1 ring-inset ring-mv-ink/15', mvBg[r.key])} />
            <div className="min-w-0">
              <p className="truncate text-base text-ink">{movementLabel(r.key, locale)}</p>
              <p className="text-xs text-ink-3">{common[locale].exercises(r.exercises)}</p>
            </div>
            <p className="text-right">
              <span className="font-num text-lg font-semibold text-ink">{formatSets(r.sets, locale)}</span>
              <span className="ml-1 text-xs text-ink-3">{m.setsUnit(r.sets)}</span>
            </p>
            <div aria-hidden className="col-start-2 col-end-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
              {r.sets > 0 && <div className={cx('h-full rounded-full', mvBg[r.key])} style={{ width: `${(r.sets / max) * 100}%` }} />}
            </div>
          </li>
        ))}
      </Panel>
    </Section>
  )
}

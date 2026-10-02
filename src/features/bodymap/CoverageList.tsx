import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { bandLabelFor, bandTargetText, type GoalId } from '../../app/bands'
import type { DayIndex } from '../../app/days'
import { formatSets, joinMeta } from '../../app/format'
import { groupName } from '../../data/localize'
import { groupShade, VOLUME_COLOR } from '../../app/volumeScale'
import type { Coverage } from '../../domain/coverage'
import { groups as allGroups, isBanded, taxonomy } from '../../domain/taxonomy'
import type { WeekResult } from '../../domain/volume'
import { useLocale } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { Chip } from '../../ui/Chip'
import { cx } from '../../ui/cx'
import { Panel, Section } from '../../ui/Page'
import { Pill } from '../../ui/Pill'
import { bodymapMessages } from './messages'
import { Why } from './Why'

type Props = {
  week: WeekResult
  coverage: Coverage
  goal: GoalId
  /** Selected day scope; rows then also show that day's sets. */
  day: DayIndex | null
  selected?: string
  onSelect: (group: string) => void
}

function Swatch({ group, sets }: { group: string; sets: number }) {
  const targets = usePrefsStore((s) => s.targets)
  return (
    <span
      className="size-3 shrink-0 rounded-full ring-1 ring-line-strong ring-inset"
      style={{ background: VOLUME_COLOR[groupShade(group, sets, 'week', targets)] }}
      aria-hidden
    />
  )
}

function Row({ group, week, goal, day, selected, onSelect }: Omit<Props, 'coverage'> & { group: string }) {
  const locale = useLocale()
  const m = bodymapMessages[locale]
  const sets = week.weekly[group] ?? 0
  const band = week.bands[group]
  const daySets = day === null ? null : (week.daily[group]?.[day] ?? 0)
  const meta = joinMeta([
    daySets !== null && m.setsOnDay(daySets, day!),
    band ? bandTargetText(band, locale) : isBanded(group) ? m.noRangeSet : m.noBand,
    band?.optional && m.optional,
  ])
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(group)}
        aria-current={selected === group ? 'true' : undefined}
        className={cx(
          'flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-2/60',
          selected === group && 'bg-surface-2/70',
        )}
      >
        <Swatch group={group} sets={sets} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium text-ink">{groupName(group, locale)}</span>
          <span className="block truncate text-sm text-ink-2 num">{meta}</span>
        </span>
        <span className="num text-md text-ink">{formatSets(sets, locale)}</span>
        {band && <Pill className="w-[6.75rem] justify-center">{bandLabelFor(band, goal)}</Pill>}
        <ChevronRight size={18} className="-mr-1 shrink-0 text-ink-3" aria-hidden />
      </button>
    </li>
  )
}

/** Per-group weekly sets with band pills; the accessible equivalent of tapping the map. */
export function CoverageList({ week, coverage, goal, day, selected, onSelect }: Props) {
  const [showOptional, setShowOptional] = useState(false)
  const locale = useLocale()
  const m = bodymapMessages[locale]
  const banded = allGroups.filter((g) => g.banded)
  const untrainedOptional = coverage.untrained.optional.map((u) => u.group)
  const main = banded.filter((g) => !untrainedOptional.includes(g.id)).map((g) => g.id)
  const unbanded = allGroups.filter((g) => !g.banded).map((g) => g.id)
  const rowProps = { week, goal, day, selected, onSelect }

  return (
    <Section
      title={m.coverage}
      description={m.groupsTrained(coverage.trainedBanded, coverage.totalBanded)}
      action={
        <Why topic={m.howBandsWork} sources={taxonomy.bandSources}>
          {m.bandsBody}
        </Why>
      }
    >
      {coverage.untrained.required.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
          <span className="text-sm text-ink-2">{m.notTrained}</span>
          {coverage.untrained.required.map((u) => (
            <Chip key={u.group} size="sm" onClick={() => onSelect(u.group)}>
              {groupName(u.group, locale)}
            </Chip>
          ))}
        </div>
      )}

      <Panel as="ul" className="divide-y divide-line overflow-hidden">
        {main.map((g) => (
          <Row key={g} group={g} {...rowProps} />
        ))}
        {untrainedOptional.length > 0 && (
          <li>
            <button
              type="button"
              aria-expanded={showOptional}
              onClick={() => setShowOptional((v) => !v)}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-base font-medium text-ink">{m.optionalNotTrained}</span>
                <span className="block truncate text-sm text-ink-2">
                  {untrainedOptional.map((g) => groupName(g, locale)).join(', ')}
                </span>
              </span>
              <ChevronDown
                size={18}
                className={cx('-mr-1 shrink-0 text-ink-3 transition-transform duration-200', showOptional && 'rotate-180')}
                aria-hidden
              />
            </button>
            {showOptional && (
              <ul className="divide-y divide-line border-t border-line">
                {untrainedOptional.map((g) => (
                  <Row key={g} group={g} {...rowProps} />
                ))}
              </ul>
            )}
          </li>
        )}
      </Panel>

      <h3 className="mb-2 mt-5 px-1 text-sm font-medium text-ink-2">{m.alsoTracked}</h3>
      <Panel as="ul" className="divide-y divide-line overflow-hidden">
        {unbanded.map((g) => (
          <Row key={g} group={g} {...rowProps} />
        ))}
      </Panel>
    </Section>
  )
}

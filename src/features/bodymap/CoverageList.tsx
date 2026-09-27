import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { bandLabelFor, targetText, type GoalId } from '../../app/bands'
import { dayName, type DayIndex } from '../../app/days'
import { formatSets, joinMeta } from '../../app/format'
import { groupShade, VOLUME_COLOR } from '../../app/volumeScale'
import type { Coverage } from '../../domain/coverage'
import { groups as allGroups, taxonomy } from '../../domain/taxonomy'
import type { WeekResult } from '../../domain/volume'
import { Chip } from '../../ui/Chip'
import { cx } from '../../ui/cx'
import { Panel, Section } from '../../ui/Page'
import { Pill } from '../../ui/Pill'
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
  return (
    <span
      className="size-3 shrink-0 rounded-full ring-1 ring-line-strong ring-inset"
      style={{ background: VOLUME_COLOR[groupShade(group, sets, 'week')] }}
      aria-hidden
    />
  )
}

function Row({ group, week, goal, day, selected, onSelect }: Omit<Props, 'coverage'> & { group: string }) {
  const g = allGroups.find((x) => x.id === group)!
  const sets = week.weekly[group] ?? 0
  const band = week.bands[group]
  const daySets = day === null ? null : (week.daily[group]?.[day] ?? 0)
  const meta = joinMeta([
    daySets !== null && `${formatSets(daySets)} on ${dayName(day!)}`,
    band ? targetText(band.edges) : 'no band',
    band?.optional && 'optional',
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
          <span className="block truncate text-base font-medium text-ink">{g.name}</span>
          <span className="block truncate text-sm text-ink-2 num">{meta}</span>
        </span>
        <span className="num text-md text-ink">{formatSets(sets)}</span>
        {band && <Pill className="w-[6.75rem] justify-center">{bandLabelFor(band, goal)}</Pill>}
        <ChevronRight size={18} className="-mr-1 shrink-0 text-ink-3" aria-hidden />
      </button>
    </li>
  )
}

/** Per-group weekly sets with band pills; the accessible equivalent of tapping the map. */
export function CoverageList({ week, coverage, goal, day, selected, onSelect }: Props) {
  const [showOptional, setShowOptional] = useState(false)
  const banded = allGroups.filter((g) => g.banded)
  const untrainedOptional = coverage.untrained.optional.map((u) => u.group)
  const main = banded.filter((g) => !untrainedOptional.includes(g.id)).map((g) => g.id)
  const unbanded = allGroups.filter((g) => !g.banded).map((g) => g.id)
  const rowProps = { week, goal, day, selected, onSelect }

  return (
    <Section
      title="Coverage"
      description={`${coverage.trainedBanded} of ${coverage.totalBanded} groups trained this week`}
      action={
        <Why topic="How bands work" sources={taxonomy.bandSources}>
          Each set counts 1.0 for a primary muscle and 0.5 for a secondary one. Weekly totals fall into bands; most
          groups sit in the target range at 10 to 20 sets. Optional groups use their own range and never read as light.
        </Why>
      }
    >
      {coverage.untrained.required.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
          <span className="text-sm text-ink-2">Not trained:</span>
          {coverage.untrained.required.map((u) => (
            <Chip key={u.group} size="sm" onClick={() => onSelect(u.group)}>
              {allGroups.find((g) => g.id === u.group)?.name ?? u.group}
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
                <span className="block text-base font-medium text-ink">Optional, not trained</span>
                <span className="block truncate text-sm text-ink-2">
                  {untrainedOptional.map((g) => allGroups.find((x) => x.id === g)?.name ?? g).join(', ')}
                </span>
              </span>
              <span className="num text-sm text-ink-3">{untrainedOptional.length}</span>
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

      <h3 className="mb-2 mt-5 px-1 text-sm font-medium text-ink-2">Also tracked, no band</h3>
      <Panel as="ul" className="divide-y divide-line overflow-hidden">
        {unbanded.map((g) => (
          <Row key={g} group={g} {...rowProps} />
        ))}
      </Panel>
    </Section>
  )
}

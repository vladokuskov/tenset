import { useNavigate } from '@tanstack/react-router'
import { NOT_MEDICAL_ADVICE } from '../../app/brand'
import type { WeekView } from '../../app/useWeek'
import { BodyMap, VolumeLegend } from '../bodymap'
import { CoverageCard } from './CoverageCard'

/** Sticky week map beside the desktop board. */
export function MapPanel({ view, highlight }: { view: WeekView; highlight: readonly string[] | null }) {
  const navigate = useNavigate()
  const { week } = view
  return (
    <aside className="sticky top-[calc(var(--safe-top)+4rem)] space-y-3 self-start" aria-label="Week map">
      <div className="rounded-xl bg-surface px-4 pb-4 pt-4">
        <h2 className="text-md font-semibold">This week</h2>
        <BodyMap
          className="mx-auto mt-3 max-w-[22rem]"
          view="both"
          values={{ groups: week.weekly, heads: week.shade.weekly }}
          scale="week"
          highlight={highlight ?? undefined}
          onSelectGroup={(group) => void navigate({ to: '/body', search: { sheet: 'muscle', group } })}
          label="Weekly volume by muscle"
        />
        <VolumeLegend scale="week" className="mt-4" />
      </div>
      <CoverageCard view={view} compact />
      <p className="px-1 text-xs text-ink-3">{NOT_MEDICAL_ADVICE}</p>
    </aside>
  )
}

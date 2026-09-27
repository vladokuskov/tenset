import { groups } from '../../domain/taxonomy'
import { BodyMap } from '../bodymap'
import { Chip } from '../../ui/Chip'
import { Sheet } from '../../ui/Sheet'

const EMPTY = { heads: {}, groups: {} }
const AREAS = [
  { id: 'upper', label: 'Upper body' },
  { id: 'core', label: 'Core' },
  { id: 'lower', label: 'Lower body' },
] as const

export type MuscleFilterSheetProps = {
  open: boolean
  onClose: () => void
  value: string | undefined
  onSelect: (group: string | undefined) => void
  /** Exercises per group under the other active filters; groups at 0 are disabled. */
  counts: Readonly<Record<string, number>>
}

/** "Filter by muscle": tap the map or pick from the list (the list is the accessible path). */
export function MuscleFilterSheet({ open, onClose, value, onSelect, counts }: MuscleFilterSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filter by muscle"
      description="Tap a muscle on the map or pick one below. Shows exercises where it is a primary muscle."
    >
      <BodyMap
        view="both"
        values={EMPTY}
        scale="week"
        highlight={value ? [value] : undefined}
        onSelectGroup={(g) => onSelect(g)}
        label="Body map, tap a muscle to filter"
        className="mx-auto max-w-[19rem]"
      />
      {AREAS.map((area) => (
        <section key={area.id} className="mt-5">
          <h3 className="mb-2 px-1 text-sm font-semibold text-ink-2">{area.label}</h3>
          <div className="flex flex-wrap gap-2">
            {groups
              .filter((g) => g.area === area.id)
              .map((g) => (
                <Chip
                  key={g.id}
                  size="sm"
                  selected={value === g.id}
                  count={counts[g.id] ?? 0}
                  disabled={!counts[g.id] && value !== g.id}
                  onClick={() => onSelect(value === g.id ? undefined : g.id)}
                >
                  {g.name}
                </Chip>
              ))}
          </div>
        </section>
      ))}
    </Sheet>
  )
}

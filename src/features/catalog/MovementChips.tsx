import { MOVEMENT_GROUPS, type MovementGroupId, type MovementKey } from '../../domain/movement'
import { useLocale } from '../../i18n/messages'
import { cx } from '../../ui/cx'
import { MovementSwatch } from '../../ui/MovementMix'
import { movementLabel, mvBg, mvVar } from '../../ui/movement'

/** One row of movement group toggles: tinted by group, the selected one filled with an ink dot. */
export function MovementChips({
  label,
  value,
  onChange,
}: {
  label: string
  value: MovementKey | undefined
  onChange: (value: MovementGroupId | undefined) => void
}) {
  const locale = useLocale()
  return (
    <div role="group" aria-label={label} className="scrollbar-none -mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1">
      {MOVEMENT_GROUPS.map(({ id }) => {
        const on = value === id
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? undefined : id)}
            className={cx(
              'hit inline-flex h-8 shrink-0 select-none items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-[background-color,color] duration-150',
              on ? cx(mvBg[id], 'text-mv-ink') : 'text-ink',
            )}
            style={on ? undefined : { background: `color-mix(in oklab, ${mvVar(id)} 30%, var(--color-surface))` }}
          >
            {on ? <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-mv-ink" /> : <MovementSwatch group={id} />}
            {movementLabel(id, locale)}
          </button>
        )
      })}
    </div>
  )
}

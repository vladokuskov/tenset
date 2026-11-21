import { MOVEMENT_GROUPS, type MovementKey, type MovementMix as Mix } from '../domain/movement'
import { formatSets } from '../app/format'
import { useLocale } from '../i18n/messages'
import { cx } from './cx'
import { mixLabel, mixParts, movementLabel, mvBg } from './movement'

export type MovementMixProps = {
  mix: Mix
  /** hair is the 3px bar under day chips; thin sits in rows and headers; big leads a panel. */
  size?: 'hair' | 'thin' | 'big'
  /** Shows every group with its set count under the bar ("Other" only when it has sets). */
  legend?: boolean
  className?: string
}

const BAR = {
  hair: 'h-[3px] gap-px rounded-full',
  thin: 'h-2 gap-0.5 rounded-full',
  big: 'h-4 gap-[3px] rounded-lg',
} as const

/** Stacked bar of sets per movement group. The aria-label names every group with sets. */
export function MovementMix({ mix, size = 'thin', legend, className }: MovementMixProps) {
  const locale = useLocale()
  const parts = mixParts(mix)
  const keys: MovementKey[] = [...MOVEMENT_GROUPS.map((g) => g.id), ...(mix.other > 0 ? (['other'] as const) : [])]
  return (
    <div className={className}>
      <div role="img" aria-label={mixLabel(mix, locale)} className={cx('flex overflow-hidden', BAR[size], parts.length === 0 && 'bg-surface-2')}>
        {parts.map((p) => (
          <span key={p.key} className={cx('min-w-1', mvBg[p.key])} style={{ flexGrow: p.sets, flexBasis: 0 }} />
        ))}
      </div>
      {legend && (
        <ul aria-hidden className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
          {keys.map((k) => (
            <li key={k} className="flex min-w-0 items-center gap-2 text-sm">
              <MovementSwatch group={k} />
              <span className="min-w-0 truncate">{movementLabel(k, locale)}</span>
              <span className="num ml-auto font-semibold">{formatSets(mix[k], locale)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export type MovementSwatchProps = {
  group: MovementKey
  shape?: 'dot' | 'square'
  /** Shows the group name next to the swatch. Without it the swatch is decorative, so name the group nearby. */
  label?: boolean
  className?: string
}

export function MovementSwatch({ group, shape = 'dot', label, className }: MovementSwatchProps) {
  const locale = useLocale()
  const swatch = (
    <span
      aria-hidden
      className={cx(
        'inline-block shrink-0 ring-1 ring-inset ring-mv-ink/15',
        shape === 'dot' ? 'size-2.5 rounded-full' : 'size-3.5 rounded-[0.25rem]',
        mvBg[group],
        !label && className,
      )}
    />
  )
  if (!label) return swatch
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-2', className)}>
      {swatch}
      <span className="min-w-0 truncate">{movementLabel(group, locale)}</span>
    </span>
  )
}

import type { MovementKey } from '../domain/movement'
import { useLocale } from '../i18n/messages'
import { cx } from './cx'
import { movementLabel, mvBg } from './movement'

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

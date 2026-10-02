import { BAND_ORDER } from '../../app/bands'
import { VOLUME_COLOR, type MapScale } from '../../app/volumeScale'
import { taxonomy, type BandEdges } from '../../domain/taxonomy'
import type { Locale } from '../../i18n/locale'
import { useLocale } from '../../i18n/messages'
import { cx } from '../../ui/cx'
import { bodymapMessages } from './messages'

// There is no per-session target in the research, so the day caption only explains the scaling.
function caption(scale: MapScale, locale: Locale): string {
  const m = bodymapMessages[locale]
  const [, lo, hi] = taxonomy.bandEdgesDefault as BandEdges
  return scale === 'week' ? m.weekCaption(lo, hi) : m.dayCaption
}

/** Calibration strip under the map; says which scale is on. */
export function VolumeLegend({ scale, className }: { scale: MapScale; className?: string }) {
  const locale = useLocale()
  const m = bodymapMessages[locale]
  return (
    <div className={cx('@container w-full', className)}>
      <ul className="grid grid-cols-6 gap-0.5" aria-label={m.colorScale(scale === 'week')}>
        {BAND_ORDER.map((b, i) => (
          <li key={b} className="min-w-0">
            <span
              className={cx('block h-2', i === 0 && 'rounded-l-full', i === BAND_ORDER.length - 1 && 'rounded-r-full')}
              style={{ background: VOLUME_COLOR[b] }}
              aria-hidden
            />
            <span className="mt-1.5 block whitespace-nowrap text-center text-[0.6875rem] leading-tight text-ink-2 @max-[20rem]:text-[0.625rem] @max-[20rem]:tracking-tight">{m.legend[b]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-center text-xs text-ink-3">{caption(scale, locale)}</p>
    </div>
  )
}

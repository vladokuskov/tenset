import { BAND_ORDER } from '../../app/bands'
import { formatSets } from '../../app/format'
import { VOLUME_COLOR, type MapScale } from '../../app/volumeScale'
import { taxonomy, type BandEdges } from '../../domain/taxonomy'
import { cx } from '../../ui/cx'

const LABELS: Record<string, string> = {
  none: 'None',
  light: 'Light',
  moderate: 'Moderate',
  target: 'Target',
  high: 'High',
  very_high: 'Very high',
}

// There is no per-session target in the research, so the day caption only explains the scaling.
function caption(scale: MapScale): string {
  const [, lo, hi] = taxonomy.bandEdgesDefault as BandEdges
  const range = `${formatSets(lo)} to ${formatSets(hi)}`
  return scale === 'week'
    ? `Week scale: weekly sets per muscle. Target for most groups: ${range}. Optional groups on the light step read "some sets".`
    : `Day scale: sets in one session, shaded on a third of the weekly ranges.`
}

/** Calibration strip under the map; says which scale is on. */
export function VolumeLegend({ scale, className }: { scale: MapScale; className?: string }) {
  return (
    <div className={cx('@container w-full', className)}>
      <ul className="grid grid-cols-6 gap-0.5" aria-label={`Color scale, ${scale === 'week' ? 'week' : 'day'}`}>
        {BAND_ORDER.map((b, i) => (
          <li key={b} className="min-w-0">
            <span
              className={cx('block h-2', i === 0 && 'rounded-l-full', i === BAND_ORDER.length - 1 && 'rounded-r-full')}
              style={{ background: VOLUME_COLOR[b] }}
              aria-hidden
            />
            <span className="mt-1.5 block whitespace-nowrap text-center text-[0.6875rem] leading-tight text-ink-2 @max-[20rem]:text-[0.625rem] @max-[20rem]:tracking-tight">{LABELS[b]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-center text-xs text-ink-3">{caption(scale)}</p>
    </div>
  )
}

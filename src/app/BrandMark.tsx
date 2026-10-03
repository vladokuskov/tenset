import { APP_NAME } from './brand'

const SEGMENTS = [
  'M32.87 7.02A25 25 0 0 1 45.98 11.27L40.39 19.56A15 15 0 0 0 32.52 17.01Z',
  'M47.39 12.3A25 25 0 0 1 55.49 23.45L46.1 26.87A15 15 0 0 0 41.23 20.18Z',
  'M56.03 25.11A25 25 0 0 1 56.03 38.89L46.42 36.13A15 15 0 0 0 46.42 27.87Z',
  'M55.49 40.55A25 25 0 0 1 47.39 51.7L41.23 43.82A15 15 0 0 0 46.1 37.13Z',
  'M45.98 52.73A25 25 0 0 1 32.87 56.98L32.52 46.99A15 15 0 0 0 40.39 44.44Z',
  'M31.13 56.98A25 25 0 0 1 18.02 52.73L23.61 44.44A15 15 0 0 0 31.48 46.99Z',
  'M16.61 51.7A25 25 0 0 1 8.51 40.55L17.9 37.13A15 15 0 0 0 22.77 43.82Z',
  'M7.97 38.89A25 25 0 0 1 7.97 25.11L17.58 27.87A15 15 0 0 0 17.58 36.13Z',
  'M8.51 23.45A25 25 0 0 1 16.61 12.3L22.77 20.18A15 15 0 0 0 17.9 26.87Z',
  'M18.02 11.27A25 25 0 0 1 31.13 7.02L31.48 17.01A15 15 0 0 0 23.61 19.56Z',
]
const FILLED = 8

/** App mark: a dial of ten sets, eight filled toward the weekly target. */
export function BrandMark({ size = 36, title = APP_NAME }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
      <rect width="64" height="64" rx="14" fill="var(--color-surface-2)" />
      {SEGMENTS.map((d, i) => (
        <path key={i} d={d} fill={i < FILLED ? 'var(--color-vol-target)' : 'var(--color-vol-none)'} />
      ))}
    </svg>
  )
}

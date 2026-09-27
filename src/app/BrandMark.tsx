import { APP_NAME } from './brand'

/** App mark: a clay tile with a torso glazed in two cobalt steps of the volume scale. */
export function BrandMark({ size = 36, title = APP_NAME }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={title}>
      <rect width="32" height="32" rx="9" fill="var(--color-surface-2)" />
      <circle cx="16" cy="8.4" r="3.1" fill="var(--color-line-strong)" />
      <path d="M16 12.6H8.7a1.9 1.9 0 0 0-1.8 2.5l3.5 10.3a1.9 1.9 0 0 0 1.8 1.3H16z" fill="var(--color-vol-target)" />
      <path d="M16 12.6h7.3a1.9 1.9 0 0 1 1.8 2.5l-3.5 10.3a1.9 1.9 0 0 1-1.8 1.3H16z" fill="var(--color-vol-high)" />
    </svg>
  )
}

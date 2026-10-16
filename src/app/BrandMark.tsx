import { APP_NAME } from './brand'

/** App mark: a lowercase t stacked from movement-colored blocks under an ink tile. */
export function BrandMark({ size = 36, title = APP_NAME }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
      <rect width="64" height="64" rx="14" fill="#16181d" />
      <rect x="25" y="7" width="14" height="10" rx="4" fill="#c7b8ff" />
      <rect x="12" y="19" width="40" height="10" rx="5" fill="#f2f3f5" />
      <rect x="25" y="31" width="14" height="10" rx="4" fill="#8eddb6" />
      <path d="M29 43h6a4 4 0 0 1 4 4h4.5a4.5 4.5 0 0 1 0 9H29a4 4 0 0 1-4-4v-5a4 4 0 0 1 4-4z" fill="#ffb680" />
    </svg>
  )
}

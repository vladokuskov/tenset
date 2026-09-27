import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { BodyMini } from '../bodymap'
import { cx } from '../../ui'

export type TemplateCardProps = {
  title: string
  meta: ReactNode
  description: ReactNode
  footnote?: ReactNode
  /** Weekly sets per group for the heat preview; omit for a grey silhouette. */
  weekly?: Readonly<Record<string, number>>
  selected: boolean
  onSelect: () => void
}

export function TemplateCard({ title, meta, description, footnote, weekly, selected, onSelect }: TemplateCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(
        'flex w-full items-start gap-4 rounded-xl border-2 bg-surface p-4 text-left transition-colors',
        selected ? 'border-ink' : 'border-transparent hover:border-line-strong',
      )}
    >
      <BodyMini view="both" groups={weekly} height={92} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="text-md font-semibold leading-snug">{title}</span>
          <span
            className={cx(
              'flex size-6 shrink-0 items-center justify-center rounded-full border',
              selected ? 'border-ink bg-ink text-on-ink' : 'border-line-strong',
            )}
            aria-hidden
          >
            {selected && <Check size={14} strokeWidth={2.5} />}
          </span>
        </span>
        <span className="num mt-0.5 block text-sm font-medium text-ink-2">{meta}</span>
        <span className="mt-1.5 line-clamp-3 text-sm text-ink-2">{description}</span>
        {footnote && <span className="num mt-2 block text-xs text-ink-3">{footnote}</span>}
      </span>
    </button>
  )
}

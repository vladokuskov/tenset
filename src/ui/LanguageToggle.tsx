import { Globe } from 'lucide-react'
import { setLocale } from '../i18n/document'
import type { Locale } from '../i18n/locale'
import { useLocale } from '../i18n/messages'
import { cx } from './cx'
import { SegmentedControl, type Segment } from './SegmentedControl'

const CODES: Record<Locale, string> = { en: 'EN', uk: 'УКР' }

const OPTIONS: readonly Segment<Locale>[] = [
  { value: 'en', label: <span lang="en">{CODES.en}</span> },
  { value: 'uk', label: <span lang="uk">{CODES.uk}</span> },
]

/** Always bilingual so people can find it in a language they don't read. */
export const LANGUAGE_LABEL = 'Мова / Language'

export function LanguageToggle({ size = 'sm', block, className }: { size?: 'sm' | 'md'; block?: boolean; className?: string }) {
  const locale = useLocale()
  return (
    <SegmentedControl label={LANGUAGE_LABEL} options={OPTIONS} value={locale} onChange={setLocale} size={size} block={block} equal className={cx('[&_button]:px-2 [&_button]:tracking-wider', className)} />
  )
}

/** Compact rail variant: shows the current language, tapping switches to the other. */
export function LanguageButton() {
  const locale = useLocale()
  const next: Locale = locale === 'en' ? 'uk' : 'en'
  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      aria-label={`${LANGUAGE_LABEL}: ${CODES[locale]} → ${CODES[next]}`}
      className="group flex flex-col items-center gap-1 py-1.5 text-xs font-medium tracking-wider text-ink-3 transition-colors hover:text-ink-2"
    >
      <span className="flex h-9 w-14 items-center justify-center rounded-full transition-colors group-hover:bg-surface-2">
        <Globe size={22} strokeWidth={1.6} aria-hidden />
      </span>
      <span lang={locale}>{CODES[locale]}</span>
    </button>
  )
}

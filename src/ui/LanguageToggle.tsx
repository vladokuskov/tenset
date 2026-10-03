import { ChevronDown, Globe } from 'lucide-react'
import { useId } from 'react'
import { setLocale } from '../i18n/document'
import { isLocale, LANGUAGES, LOCALES, type Locale } from '../i18n/locale'
import { useLocale } from '../i18n/messages'
import { cx } from './cx'
import { SegmentedControl, type Segment } from './SegmentedControl'

const OPTIONS: readonly Segment<Locale>[] = LOCALES.map((l) => ({ value: l, label: <span lang={l}>{LANGUAGES[l].code}</span> }))

/** Always bilingual so people can find it in a language they don't read. */
export const LANGUAGE_LABEL = 'Мова / Language'

export function LanguageToggle({ size = 'sm', block, className }: { size?: 'sm' | 'md'; block?: boolean; className?: string }) {
  const locale = useLocale()
  return (
    <SegmentedControl label={LANGUAGE_LABEL} options={OPTIONS} value={locale} onChange={setLocale} size={size} block={block} equal className={cx('[&_button]:px-2 [&_button]:tracking-wider', className)} />
  )
}

/** Compact rail variant: shows the current language and opens the platform language menu. The invisible select is the hit area. */
export function LanguageButton() {
  const id = useId()
  const locale = useLocale()
  return (
    <div className="group relative flex flex-col items-center gap-1 py-1.5 text-xs font-medium tracking-wider text-ink-3 transition-colors hover:text-ink-2 [&:has(select:focus-visible)]:outline-2 [&:has(select:focus-visible)]:outline-offset-2 [&:has(select:focus-visible)]:outline-accent rounded-lg">
      <label htmlFor={id} className="sr-only">
        {LANGUAGE_LABEL}
      </label>
      <span aria-hidden className="flex h-9 w-14 items-center justify-center rounded-full transition-colors group-hover:bg-surface-2">
        <Globe size={22} strokeWidth={1.6} />
      </span>
      <span aria-hidden className="flex items-center gap-0.5">
        <span lang={locale}>{LANGUAGES[locale].code}</span>
        <ChevronDown size={12} strokeWidth={2} />
      </span>
      <select
        id={id}
        value={locale}
        onChange={(e) => isLocale(e.target.value) && setLocale(e.target.value)}
        className="absolute inset-0 cursor-pointer appearance-none opacity-0"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LANGUAGES[l].name}
          </option>
        ))}
      </select>
    </div>
  )
}

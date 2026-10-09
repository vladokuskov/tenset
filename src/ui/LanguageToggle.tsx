import { ChevronDown, Globe } from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'
import { setLocale } from '../i18n/document'
import { LANGUAGES, LOCALES, type Locale } from '../i18n/locale'
import { useLocale, useMessages } from '../i18n/messages'
import { cx } from './cx'
import { uiMessages } from './messages'
import { SegmentedControl, type Segment } from './SegmentedControl'
import { Select } from './Select'

const OPTIONS: readonly Segment<Locale>[] = LOCALES.map((l) => ({ value: l, label: <span lang={l}>{LANGUAGES[l].name}</span> }))

/** Sample letters in each script, so the choice reads without knowing either language. */
const GLYPH: Record<Locale, string> = { en: 'Aa', uk: 'Аа' }

/** Always bilingual so people can find it in a language they don't read. */
export const LANGUAGE_LABEL = 'Мова / Language'

export function LanguageToggle({ size = 'md', block, className }: { size?: 'sm' | 'md'; block?: boolean; className?: string }) {
  const locale = useLocale()
  return <SegmentedControl label={LANGUAGE_LABEL} options={OPTIONS} value={locale} onChange={setLocale} size={size} block={block} equal className={className} />
}

/** Two large choices for the first-run screen. */
export function LanguageCards({ className }: { className?: string }) {
  const locale = useLocale()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (LOCALES.indexOf(locale) + step + LOCALES.length) % LOCALES.length
    setLocale(LOCALES[next])
    refs.current[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-label={LANGUAGE_LABEL} onKeyDown={onKeyDown} className={cx('grid grid-cols-2 gap-2.5', className)}>
      {LOCALES.map((l, i) => {
        const checked = l === locale
        return (
          <button
            key={l}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            lang={l}
            onClick={() => setLocale(l)}
            className={cx(
              'flex h-14 items-center gap-3 rounded-lg border bg-raised px-3.5 text-left transition-[border-color,box-shadow] duration-150',
              checked ? 'border-ink shadow-[inset_0_0_0_0.5px_var(--color-ink)]' : 'border-line hover:border-line-strong',
            )}
          >
            <span aria-hidden className={cx('text-xl font-semibold tracking-[-0.02em]', checked ? 'text-accent' : 'text-ink-3')}>
              {GLYPH[l]}
            </span>
            <span className="font-semibold text-ink">{LANGUAGES[l].name}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Compact rail variant: shows the current language and opens a menu beside the rail. */
export function LanguageButton() {
  const locale = useLocale()
  const m = useMessages(uiMessages)
  return (
    <Select
      label={LANGUAGE_LABEL}
      variant="custom"
      side="right"
      value={locale}
      onChange={setLocale}
      groups={[
        {
          label: LANGUAGE_LABEL,
          options: LOCALES.map((l) => ({
            value: l,
            label: LANGUAGES[l].name,
            hint: m.language[l] === LANGUAGES[l].name ? undefined : m.language[l],
            lang: l,
          })),
        },
      ]}
      className="group flex flex-col items-center gap-1 rounded-lg py-1.5 text-xs font-medium tracking-wider text-ink-3 transition-colors hover:text-ink-2 aria-expanded:text-ink"
    >
      <span aria-hidden className="flex h-9 w-14 items-center justify-center rounded-full transition-colors group-hover:bg-surface-2 group-aria-expanded:bg-surface-2">
        <Globe size={22} strokeWidth={1.6} />
      </span>
      <span aria-hidden className="flex items-center gap-0.5">
        <span lang={locale}>{LANGUAGES[locale].code}</span>
        <ChevronDown size={12} strokeWidth={2} />
      </span>
    </Select>
  )
}

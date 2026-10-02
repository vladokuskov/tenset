import { setLocale } from '../i18n/document'
import type { Locale } from '../i18n/locale'
import { useLocale } from '../i18n/messages'
import { SegmentedControl, type Segment } from './SegmentedControl'

const OPTIONS: readonly Segment<Locale>[] = [
  { value: 'en', label: <span lang="en">EN</span> },
  { value: 'uk', label: <span lang="uk">УКР</span> },
]

/** Always bilingual so people can find it in a language they don't read. */
export const LANGUAGE_LABEL = 'Мова / Language'

export function LanguageToggle({ size = 'sm', block, className }: { size?: 'sm' | 'md'; block?: boolean; className?: string }) {
  const locale = useLocale()
  return (
    <SegmentedControl label={LANGUAGE_LABEL} options={OPTIONS} value={locale} onChange={setLocale} size={size} block={block} className={className} />
  )
}

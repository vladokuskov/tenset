import { Globe } from 'lucide-react'
import { setLocale } from '../i18n/document'
import { LANGUAGES, LOCALES } from '../i18n/locale'
import { useLocale, useMessages } from '../i18n/messages'
import { uiMessages } from './messages'
import { Select } from './Select'
import { iconButtonClass } from './styles'

/** Always bilingual so people can find it in a language they don't read. */
const LANGUAGE_LABEL = 'Мова / Language'

/** Toolbar button showing the current language code; opens a menu (a sheet on phones) of languages, each in its own script. */
export function LanguagePicker() {
  const locale = useLocale()
  const m = useMessages(uiMessages)
  return (
    <Select
      label={LANGUAGE_LABEL}
      variant="custom"
      value={locale}
      onChange={setLocale}
      groups={[
        {
          options: LOCALES.map((l) => ({
            value: l,
            label: LANGUAGES[l].name,
            hint: m.language[l] === LANGUAGES[l].name ? undefined : m.language[l],
            lang: l,
          })),
        },
      ]}
      className={iconButtonClass({}, 'w-auto gap-1 px-2.5 text-sm font-semibold')}
    >
      <Globe size={20} strokeWidth={1.75} aria-hidden />
      <span aria-hidden lang={locale}>
        {LANGUAGES[locale].code}
      </span>
    </Select>
  )
}

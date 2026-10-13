import { ENTRY_NOTE_MAX } from '../../domain/program'
import { useLocale } from '../../i18n/messages'
import { builderMessages } from './messages'

/** Controlled single-line note; the sheet saves it on blur and before it closes. */
export function EntryNoteField({
  value,
  name,
  onChange,
  onSave,
  className,
}: {
  value: string
  name: string
  onChange: (value: string) => void
  onSave: () => void
  className?: string
}) {
  const m = builderMessages[useLocale()]
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="text-sm font-semibold">{m.entryNote}</span>
      <input
        value={value}
        maxLength={ENTRY_NOTE_MAX}
        aria-label={m.entryNoteFor(name)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onSave}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), e.preventDefault())}
        placeholder={m.entryNotePlaceholder}
        enterKeyHint="done"
        className="mt-1.5 h-11 w-full rounded-md bg-surface-2 px-3 text-base text-ink placeholder:text-ink-3"
      />
      <span className="mt-1 flex justify-between gap-3 text-xs text-ink-3">
        <span>{m.entryNoteHint}</span>
        <span className="num">
          {value.length}/{ENTRY_NOTE_MAX}
        </span>
      </span>
    </label>
  )
}

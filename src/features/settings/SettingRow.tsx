import type { ReactNode } from 'react'

/** One setting inside a Panel: label and hint, control beside them on wider screens and below on phone. */
export function SettingRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:gap-8">
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-medium text-ink">{label}</h3>
        {hint && <div className="mt-0.5 text-sm text-ink-2">{hint}</div>}
      </div>
      <div className="flex min-w-0 items-center gap-3 md:w-[24rem] md:shrink-0">{children}</div>
    </div>
  )
}

/** Current value and the button that opens its sheet. */
export function SettingValue({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <>
      <span className="num min-w-0 flex-1 truncate text-base text-ink-2 md:text-right">{children}</span>
      {action}
    </>
  )
}

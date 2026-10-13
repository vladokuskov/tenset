import { useState } from 'react'
import { useCatalog } from '../../app/useCatalog'
import { groupName } from '../../data/localize'
import { useLocale, useMessages } from '../../i18n/messages'
import { usePrefsStore, prefsStore } from '../../store/prefs.store'
import { useActiveProgram } from '../../store/program.store'
import { Button, Sheet } from '../../ui'
import { ChangeBar } from '../shared/ChangeBar'
import { settingsMessages } from './messages'

type OverrideRole = 'primary' | 'secondary' | 'none'

/** Exercises whose muscle roles the user changed, each with a reset (Undo instead of a confirm). */
export function OverridesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const overrides = usePrefsStore((s) => s.overrides)
  const resetOverrides = usePrefsStore((s) => s.resetOverrides)
  const program = useActiveProgram()
  const { catalog } = useCatalog()
  const m = useMessages(settingsMessages)
  const locale = useLocale()
  const [status, setStatus] = useState<{ message: string; restore: typeof overrides } | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setStatus(null)
  }

  const rows = Object.entries(overrides).map(([id, ov]) => {
    const catalogEx = /^\d+$/.test(id) ? catalog.get(Number(id)) : undefined
    const custom = program?.custom.find((c) => c.id === id)
    const base: Record<string, string> = catalogEx?.groups ?? custom?.groups ?? {}
    return {
      id,
      name: catalogEx?.name ?? custom?.name ?? m.noLongerAvailable,
      changes: Object.entries(ov).map(([g, r]) => ({ group: g, role: r, was: (base[g] ?? 'none') as OverrideRole })),
    }
  })

  const reset = (id?: string) => {
    const before = prefsStore.getState().overrides
    resetOverrides(id)
    const name = id ? rows.find((r) => r.id === id)?.name : undefined
    setStatus({ message: name ? m.resetDone(name) : m.resetAllDone, restore: before })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={m.customMappings}
      description={m.overridesHint}
      footer={
        status ? (
          <ChangeBar
            message={status.message}
            onUndo={() => {
              prefsStore.setState({ overrides: status.restore })
              setStatus(null)
            }}
          />
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-base text-ink-2">{m.noOverrides}</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium">{r.name}</p>
                  <ul className="mt-1 space-y-0.5 text-sm text-ink-2">
                    {r.changes.map((c) => (
                      <li key={c.group}>
                        {m.changeLine(groupName(c.group, locale), m.role[c.role], m.role[c.was])}
                      </li>
                    ))}
                  </ul>
                </div>
                <Button size="sm" onClick={() => reset(r.id)}>
                  {m.reset}
                </Button>
              </li>
            ))}
          </ul>
          {rows.length > 1 && (
            <Button className="mt-4" block onClick={() => reset()}>
              {m.resetAll}
            </Button>
          )}
        </>
      )}
    </Sheet>
  )
}

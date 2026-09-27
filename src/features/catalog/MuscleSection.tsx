import { useState } from 'react'
import { ROLE_COLOR } from '../../app/volumeScale'
import type { Role } from '../../domain/schema'
import { getGroup } from '../../domain/taxonomy'
import { BodyMini } from '../bodymap'
import { Chip } from '../../ui/Chip'

/** Primary and secondary chips; tapping one shows only that muscle on the mini map. */
export function MuscleSection({
  roles,
  countingMode,
}: {
  roles: Readonly<Record<string, Role>>
  countingMode: 'fractional' | 'primary'
}) {
  const [focus, setFocus] = useState<string | null>(null)
  const current = focus && roles[focus] ? focus : null
  const shown = current ? { [current]: roles[current] } : roles
  const byRole = (role: Role) => Object.keys(roles).filter((g) => roles[g] === role)
  const name = (g: string) => getGroup(g)?.name ?? g

  return (
    <div className="flex items-start gap-4">
      <BodyMini
        view="both"
        roles={shown}
        height={150}
        label={current ? `${name(current)} on the body map` : 'Muscles worked on the body map'}
        className="shrink-0 rounded-lg bg-surface-2 px-2 py-2"
      />
      <div className="min-w-0 flex-1 space-y-4">
        {(['primary', 'secondary'] as const).map((role) => {
          const list = byRole(role)
          return (
            <div key={role}>
              <p className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: ROLE_COLOR[role] }} aria-hidden />
                {role === 'primary' ? 'Primary' : 'Secondary'}
              </p>
              {list.length ? (
                <div className="flex flex-wrap gap-2">
                  {list.map((g) => (
                    <Chip key={g} size="sm" selected={current === g} onClick={() => setFocus(current === g ? null : g)}>
                      {name(g)}
                    </Chip>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-3">None</p>
              )}
            </div>
          )
        })}
        <p className="text-sm text-ink-3">
          {countingMode === 'primary'
            ? 'Each set counts 1 for primary muscles. Secondary muscles are not counted in your settings.'
            : 'Each set counts 1 for primary muscles and 0.5 for secondary ones.'}
        </p>
      </div>
    </div>
  )
}

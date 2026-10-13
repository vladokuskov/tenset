import { ArrowRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { dayName, sortDays } from '../../app/days'
import { useCatalog } from '../../app/useCatalog'
import { exercisesNeedingOther } from '../../domain/equipment'
import { planEquipmentSwap, type EquipmentSwap } from '../../domain/equipmentSwap'
import type { Program } from '../../domain/schema'
import { common } from '../../i18n/common'
import { useLocale, useMessages } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { Button, VisuallyHidden, cx } from '../../ui'
import { sharedMessages } from './messages'

export type EquipmentSwapProps = {
  program: Program
  available: readonly string[]
  /** Sentence for how many exercises need other equipment. */
  describe: (n: number) => string
  onApply: (swaps: EquipmentSwap[]) => void
  className?: string
}

/** "N exercises need other equipment", then a reviewable list of swaps applied in one go. */
export function EquipmentSwapPanel({ program, available, describe, onApply, className }: EquipmentSwapProps) {
  const { catalog, activeExercises } = useCatalog()
  const weekStart = usePrefsStore((s) => s.weekStart)
  const m = useMessages(sharedMessages).swap
  const locale = useLocale()
  const [reviewing, setReviewing] = useState(false)
  const needOther = exercisesNeedingOther(program, catalog, available)
  const plan = useMemo(() => planEquipmentSwap(program, catalog, activeExercises, available), [program, catalog, activeExercises, available])

  if (needOther === 0) return null
  const order = sortDays([0, 1, 2, 3, 4, 5, 6], weekStart)
  const swaps = [...plan.swaps].sort((a, b) => order.indexOf(a.day) - order.indexOf(b.day))
  const name = (id: number) => catalog.get(id)?.name ?? String(id)

  return (
    <div className={cx('rounded-xl bg-surface-2 p-4', className)} data-equipment-swap>
      <p className="text-sm text-ink">{describe(needOther)}</p>
      {swaps.length === 0 && <p className="mt-2 text-sm text-ink-2">{m.noFit(needOther)}</p>}
      {!reviewing && swaps.length > 0 && (
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => setReviewing(true)}>
          {m.action}
        </Button>
      )}
      {reviewing && (
        <>
          <p className="mt-2 text-sm text-ink-2">{m.keeps}</p>
          <ul className="mt-2 divide-y divide-line" aria-label={m.action}>
            {swaps.map((s) => (
              <li key={s.entryId} className="flex gap-3 py-2 text-sm">
                <span className="w-9 shrink-0 font-semibold">{dayName(s.day, 'short', locale)}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-ink-2">{name(s.from)}</span>
                  <ArrowRight size={14} aria-hidden className="mx-1 inline align-[-2px] text-ink-3" />
                  <VisuallyHidden>{` ${m.to} `}</VisuallyHidden>
                  <span className="font-medium text-ink">{name(s.to)}</span>
                </span>
              </li>
            ))}
          </ul>
          {plan.unmatched > 0 && <p className="mt-2 text-sm text-ink-2">{m.noFit(plan.unmatched)}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setReviewing(false)}>
              {common[locale].cancel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setReviewing(false)
                onApply(swaps)
              }}
            >
              {m.apply(swaps.length)}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

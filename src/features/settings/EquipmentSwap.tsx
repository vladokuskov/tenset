import { useEffect, useRef, useState } from 'react'
import type { EquipmentSwap } from '../../domain/equipmentSwap'
import type { Program } from '../../domain/schema'
import { common } from '../../i18n/common'
import { useMessages } from '../../i18n/messages'
import { useProgramStore } from '../../store/program.store'
import { ChangeBar } from '../shared/ChangeBar'
import { EquipmentSwapPanel } from '../shared/EquipmentSwapPanel'
import { sharedMessages } from '../shared/messages'
import { carryUndo, undoLastChange, useChange } from '../shared/useChange'
import { settingsMessages } from './messages'

/** The swap panel for the active program, with the week delta and one Undo in place (it sits in a sheet). */
export function ActiveProgramSwap({ program, available, className }: { program: Program; available: readonly string[]; className?: string }) {
  const swapEntries = useProgramStore((s) => s.swapEntries)
  const change = useChange()
  const msgs = useMessages(settingsMessages)
  const swapText = useMessages(sharedMessages).swap
  const c = useMessages(common)
  const [status, setStatus] = useState<string | null>(null)
  const last = useRef<string | null>(null)
  const report = (message: string) => {
    last.current = message
    setStatus(message)
  }
  // The sheet unmounts this when it closes; Undo then moves to a toast.
  useEffect(() => () => carryUndo(last.current), [])

  const apply = (swaps: EquipmentSwap[]) => {
    const res = change(swapText.done(swaps.length), () => swapEntries(swaps), { toast: false })
    if (res) report(res.message)
  }

  return (
    <>
      <EquipmentSwapPanel program={program} available={available} describe={msgs.needOther} onApply={apply} className={className} />
      {status && (
        <ChangeBar
          className="mt-2"
          message={status}
          onUndo={status !== c.undone ? () => undoLastChange() && report(c.undone) : undefined}
        />
      )}
    </>
  )
}

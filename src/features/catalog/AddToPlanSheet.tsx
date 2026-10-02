import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import type { DayIndex } from '../../app/days'
import type { Exercise } from '../../domain/schema'
import { useMessages } from '../../i18n/messages'
import { useActiveProgram } from '../../store/program.store'
import { usePrefsStore } from '../../store/prefs.store'
import { Button } from '../../ui/Button'
import { Sheet } from '../../ui/Sheet'
import { DayPicker } from '../builder'
import { addToDays } from './addToPlan'
import { daySets, lightestTrainingDay } from './detail'
import { catalogMessages } from './messages'

export type AddToPlanSheetProps = {
  exercise: Exercise
  open: boolean
  onClose: () => void
  /** Days selected when the sheet opens; defaults to the lightest training day. */
  initial?: readonly DayIndex[]
}

/** Multi-select day picker for "Add to plan". One undoable change for all picked days. */
export function AddToPlanSheet({ exercise, open, onClose, initial }: AddToPlanSheetProps) {
  const program = useActiveProgram()
  const weekStart = usePrefsStore((s) => s.weekStart)
  const goal = usePrefsStore((s) => s.goal)
  const navigate = useNavigate()
  const m = useMessages(catalogMessages)
  const [picked, setPicked] = useState<DayIndex[] | null>(null)

  const lightest = program ? lightestTrainingDay(program, weekStart) : null
  const value = picked ?? (initial?.length ? [...initial] : lightest !== null ? [lightest] : [])
  const hints = program
    ? Object.fromEntries(program.days.map((d, i) => [i, d.kind === 'rest' ? m.rest : String(daySets(program, i))]))
    : undefined

  const close = () => {
    setPicked(null)
    onClose()
  }

  const confirm = () => {
    if (!program) {
      void navigate({ to: '/welcome' })
      return
    }
    addToDays(exercise, value, goal, weekStart)
    close()
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={m.addToPlan}
      description={
        program
          ? m.addDescription(exercise.name, exercise.defaults.sets)
          : m.noPlanDescription
      }
      desktop="center"
      footer={
        <Button variant="primary" size="lg" block disabled={program ? value.length === 0 : false} onClick={confirm}>
          {!program ? m.createPlan : value.length ? m.addToDays(value, weekStart) : m.pickDays}
        </Button>
      }
    >
      {program && (
        <>
          <DayPicker label={m.daysToAddTo} value={value} onChange={setPicked} hints={hints} />
          {!picked && lightest !== null && !initial?.length && (
            <p className="mt-3 text-sm text-ink-2">{m.preselected}</p>
          )}
        </>
      )}
    </Sheet>
  )
}

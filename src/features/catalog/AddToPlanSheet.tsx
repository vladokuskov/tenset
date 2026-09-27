import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { formatDayList, type DayIndex } from '../../app/days'
import type { Exercise } from '../../domain/schema'
import { useActiveProgram } from '../../store/program.store'
import { usePrefsStore } from '../../store/prefs.store'
import { Button } from '../../ui/Button'
import { Sheet } from '../../ui/Sheet'
import { DayPicker } from '../builder'
import { addToDays } from './addToPlan'
import { daySets, lightestTrainingDay } from './detail'

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
  const [picked, setPicked] = useState<DayIndex[] | null>(null)

  const lightest = program ? lightestTrainingDay(program, weekStart) : null
  const value = picked ?? (initial?.length ? [...initial] : lightest !== null ? [lightest] : [])
  const hints = program
    ? Object.fromEntries(program.days.map((d, i) => [i, d.kind === 'rest' ? 'Rest' : String(daySets(program, i))]))
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
      title="Add to plan"
      description={
        program
          ? `${exercise.name}, ${exercise.defaults.sets} sets per day. Numbers show sets already planned.`
          : 'Create a plan first, then add exercises to its days.'
      }
      desktop="center"
      footer={
        <Button variant="primary" size="lg" block disabled={program ? value.length === 0 : false} onClick={confirm}>
          {!program ? 'Create a plan' : value.length ? `Add to ${formatDayList(value, weekStart, value.length === 1 ? 'long' : 'short')}` : 'Pick one or more days'}
        </Button>
      }
    >
      {program && (
        <>
          <DayPicker label="Days to add to" value={value} onChange={setPicked} hints={hints} />
          {!picked && lightest !== null && !initial?.length && (
            <p className="mt-3 text-sm text-ink-2">Preselected your lightest training day.</p>
          )}
        </>
      )}
    </Sheet>
  )
}

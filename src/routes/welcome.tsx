import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { hasAnyProgram } from '../app/firstRun'
import { stepParam } from '../app/search'
import { WelcomeScreen } from '../features/welcome/WelcomeScreen'

// URL contract: /welcome?step=1|2|3 (each step is a history entry, so back goes to the previous step)
const WelcomeSearch = z.object({ step: stepParam(3) })

export const Route = createFileRoute('/welcome')({
  validateSearch: WelcomeSearch,
  // Back from the Plan after finishing lands here; never run first run twice (it would add a program).
  beforeLoad: () => {
    if (hasAnyProgram()) throw redirect({ to: '/', replace: true })
  },
  component: WelcomeScreen,
})

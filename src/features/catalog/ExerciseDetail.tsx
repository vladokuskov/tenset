import { Link, getRouteApi, useNavigate, useRouter } from '@tanstack/react-router'
import { CalendarDays, CalendarPlus, SearchX, SlidersHorizontal } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { NOT_MEDICAL_ADVICE } from '../../app/brand'
import { dayFromSlug, dayName, daySlug, type DayIndex } from '../../app/days'
import { useCatalog } from '../../app/useCatalog'
import { equipment as equipmentList } from '../../domain/equipment'
import type { Exercise } from '../../domain/schema'
import { useActiveProgram } from '../../store/program.store'
import { usePrefsStore } from '../../store/prefs.store'
import { Button, EmptyState, IconButton, LinkButton, Page, PageBody, PageHeader, Panel, Pill, Section, StickyActions, useSheet } from '../../ui'
import { AddToPlanSheet } from './AddToPlanSheet'
import { addToDays } from './addToPlan'
import { alternativesFor } from './alternatives'
import { CountsSheet } from './CountsSheet'
import { shortCite } from './detail'
import { hasMotion } from '../figure/motion/library'
import { ExerciseMedia } from './ExerciseMotion'
import { ExerciseRow } from './ExerciseRow'
import { MuscleSection } from './MuscleSection'
import { LEVEL_LABEL, PATTERN_LABEL } from './patterns'
import { useIsCustomized, useRoles } from './useRoles'

const route = getRouteApi('/exercise/$slug')
const equipmentName = new Map(equipmentList.map((e) => [e.id, e.name]))
const listEquipment = (ids: readonly string[]) => ids.map((e) => equipmentName.get(e) ?? e).join(', ')

const SIDES: Record<Exercise['laterality'], string | null> = {
  bilateral: null,
  unilateral: 'One side at a time. Sets count once, not per side.',
  alternating: 'Alternating sides. Sets count once, not per side.',
}

export function ExercisePage() {
  const { slug } = route.useParams()
  const { exerciseBySlug } = useCatalog()
  const exercise = exerciseBySlug.get(slug)
  if (!exercise) {
    return (
      <Page>
        <PageHeader title="Exercise" back={{ to: '/exercises', label: 'Exercises' }} />
        <EmptyState
          icon={SearchX}
          title="Exercise not found"
          actions={
            <LinkButton to="/exercises" variant="primary">
              Browse exercises
            </LinkButton>
          }
        >
          It may have been renamed or removed from the catalog.
        </EmptyState>
      </Page>
    )
  }
  return <ExerciseDetail key={exercise.id} exercise={exercise} />
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-3">
      <dt className="shrink-0 text-ink-2">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  )
}

function ExerciseDetail({ exercise }: { exercise: Exercise }) {
  const search = route.useSearch()
  const router = useRouter()
  const navigate = useNavigate()
  const { activeExercises } = useCatalog()
  const program = useActiveProgram()
  const available = usePrefsStore((s) => s.equipment)
  const goal = usePrefsStore((s) => s.goal)
  const weekStart = usePrefsStore((s) => s.weekStart)
  const countingMode = usePrefsStore((s) => s.countingMode)
  const roles = useRoles(exercise)
  const customized = useIsCustomized(exercise)
  const days = useSheet('days')
  const counts = useSheet('counts')
  const alternatives = useMemo(() => alternativesFor(exercise, activeExercises, available), [exercise, activeExercises, available])

  const addTo: DayIndex | undefined =
    search.addTo === undefined ? undefined : typeof search.addTo === 'number' ? search.addTo : dayFromSlug(search.addTo)
  const from = search.from ? dayFromSlug(search.from) : undefined
  const availableSet = new Set(available)
  const missing = (e: Exercise) => e.equipment.filter((x) => !availableSet.has(x))

  const addDirect = (day: DayIndex) => {
    if (!program) {
      void navigate({ to: '/welcome' })
      return
    }
    addToDays(exercise, [day], goal, weekStart)
    if (router.history.canGoBack()) router.history.back()
    else void navigate({ to: '/day/$dow', params: { dow: daySlug(day) } })
  }

  return (
    <Page>
      <PageHeader
        title={exercise.name}
        back={addTo !== undefined ? { to: '/', label: dayName(addTo, 'long') } : { to: '/exercises', label: 'Exercises' }}
      />
      <PageBody>
        <ExerciseMedia exercise={exercise} />
        {exercise.media.status === 'card' && !hasMotion(exercise.id) && (
          <p className="mt-2 text-center text-sm text-ink-3">Demo coming. Until then the map shows the muscles worked.</p>
        )}

        <Section
          title={
            <span className="flex items-center gap-2">
              Muscles
              {customized && <Pill variant="soft">custom</Pill>}
            </span>
          }
          className="mt-6"
          action={
            <Button variant="link" size="sm" icon={SlidersHorizontal} onClick={() => counts.show()}>
              Edit how this counts
            </Button>
          }
        >
          <Panel className="p-4">
            <MuscleSection roles={roles} countingMode={countingMode} />
            <p className="mt-4 text-sm text-ink-2">
              Mapping confidence: {exercise.confidence}.{' '}
              {exercise.basis.length > 0 && <>Based on {exercise.basis.map(shortCite).join(', ')}. </>}
              <Link to="/about" hash="sources" className="text-accent underline underline-offset-2">
                Sources
              </Link>
            </p>
          </Panel>
        </Section>

        <Section title="Details">
          <Panel className="px-4">
            <dl className="divide-y divide-line">
              <Fact label="Equipment">{exercise.equipment.length ? listEquipment(exercise.equipment) : 'None, bodyweight'}</Fact>
              <Fact label="Pattern">{PATTERN_LABEL[exercise.pattern]}</Fact>
              <Fact label="Level">{LEVEL_LABEL[exercise.level]}</Fact>
              <Fact label="Default">
                {exercise.defaults.sets} sets of {goal === 'strength' && exercise.defaults.strengthReps ? exercise.defaults.strengthReps : exercise.defaults.reps}
                {exercise.unit === 'seconds' ? ' s' : ''}
              </Fact>
              {SIDES[exercise.laterality] && <Fact label="Sides">{SIDES[exercise.laterality]}</Fact>}
            </dl>
          </Panel>
        </Section>

        <Section title="How to do it">
          <Panel className="px-4 py-1">
            <ol className="divide-y divide-line">
              {exercise.cues.map((c, i) => (
                <li key={c} className="flex gap-3 py-3">
                  <span className="num w-5 shrink-0 text-right font-semibold text-ink-3" aria-hidden>
                    {i + 1}
                  </span>
                  <span>{c}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </Section>

        <Section title="Alternatives" description="Same movement pattern, your equipment first.">
          {alternatives.length ? (
            <Panel as="ul" className="divide-y divide-line px-3">
              {alternatives.map(({ exercise: alt, available: ok }) => (
                <li key={alt.id}>
                  <ExerciseRow
                    exercise={alt}
                    link
                    meta={ok ? undefined : `Needs ${listEquipment(missing(alt)).toLowerCase()}`}
                  />
                </li>
              ))}
            </Panel>
          ) : (
            <p className="px-1 text-sm text-ink-2">No close alternatives in the catalog yet.</p>
          )}
        </Section>

        <p className="mt-8 px-1 text-xs text-ink-3">{NOT_MEDICAL_ADVICE}</p>
      </PageBody>

      <StickyActions>
        {addTo !== undefined ? (
          <>
            <Button variant="primary" size="lg" block icon={CalendarPlus} onClick={() => addDirect(addTo)}>
              Add to {dayName(addTo, 'long')}
            </Button>
            <IconButton icon={CalendarDays} label="Choose other days" variant="tonal" onClick={() => days.show()} />
          </>
        ) : (
          <Button variant="primary" size="lg" block icon={CalendarPlus} onClick={() => days.show()}>
            Add to plan
          </Button>
        )}
      </StickyActions>

      <AddToPlanSheet
        exercise={exercise}
        open={days.open}
        onClose={days.close}
        initial={addTo !== undefined ? [addTo] : from !== undefined ? [from] : undefined}
      />
      <CountsSheet exercise={exercise} open={counts.open} onClose={counts.close} />
    </Page>
  )
}

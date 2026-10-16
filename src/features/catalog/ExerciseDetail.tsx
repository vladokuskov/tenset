import { Link, getRouteApi, useNavigate, useRouter } from '@tanstack/react-router'
import { CalendarDays, CalendarPlus, SearchX, SlidersHorizontal } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { NotMedicalAdvice } from '../../app/brand'
import { dayFromSlug, dayName, daySlug, type DayIndex } from '../../app/days'
import { useCatalog } from '../../app/useCatalog'
import { equipmentName } from '../../data/localize'
import type { Exercise } from '../../domain/schema'
import type { Locale } from '../../i18n/locale'
import { useLocale, useMessages } from '../../i18n/messages'
import { useActiveProgram } from '../../store/program.store'
import { usePrefsStore } from '../../store/prefs.store'
import { Button, EmptyState, IconButton, LinkButton, movementLabel, MovementSwatch, Page, PageBody, PageHeader, Panel, Pill, Section, StickyActions, useSheet } from '../../ui'
import { AddToPlanSheet } from './AddToPlanSheet'
import { addToDays } from './addToPlan'
import { alternativesFor } from '../../domain/alternatives'
import { CountsSheet } from './CountsSheet'
import { shortCite } from './detail'
import { ExerciseMedia } from './ExerciseMotion'
import { exerciseGroup, showsMotion } from './media'
import { catalogMessages } from './messages'
import { ExerciseRow } from './ExerciseRow'
import { MuscleSection } from './MuscleSection'
import { levelLabel, patternLabel } from './patterns'
import { useIsCustomized, useRoles } from './useRoles'

const route = getRouteApi('/exercise/$slug')
const listEquipment = (ids: readonly string[], locale: Locale) => ids.map((e) => equipmentName(e, locale)).join(', ')

export function ExercisePage() {
  const { slug } = route.useParams()
  const { exerciseBySlug } = useCatalog()
  const exercise = exerciseBySlug.get(slug)
  const m = useMessages(catalogMessages)
  if (!exercise) {
    return (
      <Page>
        <PageHeader title={m.exercise} back={{ to: '/exercises', label: m.exercises }} />
        <EmptyState
          icon={SearchX}
          title={m.notFound}
          actions={
            <LinkButton to="/exercises" variant="primary">
              {m.browse}
            </LinkButton>
          }
        >
          {m.notFoundBody}
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
  const { activeExercises, catalog } = useCatalog()
  const program = useActiveProgram()
  const available = usePrefsStore((s) => s.equipment)
  const goal = usePrefsStore((s) => s.goal)
  const weekStart = usePrefsStore((s) => s.weekStart)
  const countingMode = usePrefsStore((s) => s.countingMode)
  const overrides = usePrefsStore((s) => s.overrides)
  const locale = useLocale()
  const m = catalogMessages[locale]
  const roles = useRoles(exercise)
  const customized = useIsCustomized(exercise)
  const days = useSheet('days')
  const counts = useSheet('counts')
  const custom = program?.custom
  const alternatives = useMemo(
    () => alternativesFor(exercise, activeExercises, available, { catalog, custom: custom ?? [], countingMode, overrides }),
    [exercise, activeExercises, available, catalog, custom, countingMode, overrides],
  )

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
        back={addTo !== undefined ? { to: '/', label: dayName(addTo, 'long', locale) } : { to: '/exercises', label: m.exercises }}
      />
      <PageBody>
        <ExerciseMedia exercise={exercise} />
        {!showsMotion(exercise) && (
          <p className="mt-2 text-center text-sm text-ink-3">{m.demoComing}</p>
        )}

        <Section
          title={
            <span className="flex items-center gap-2">
              {m.muscles}
              {customized && <Pill variant="soft">{m.custom}</Pill>}
            </span>
          }
          className="mt-6"
          action={
            <Button variant="link" size="sm" icon={SlidersHorizontal} onClick={() => counts.show()}>
              {m.editCounts}
            </Button>
          }
        >
          <Panel className="p-4">
            <MuscleSection roles={roles} countingMode={countingMode} />
            <p className="mt-4 text-sm text-ink-2">
              {m.mappingConfidence(exercise.confidence)}{' '}
              {exercise.basis.length > 0 && <>{m.basedOn(exercise.basis.map(shortCite).join(', '))} </>}
              <Link to="/about" hash="sources" className="text-accent underline underline-offset-2">
                {m.sources}
              </Link>
            </p>
          </Panel>
        </Section>

        <Section title={m.details}>
          <Panel className="px-4">
            <dl className="divide-y divide-line">
              <Fact label={m.equipment}>
                {exercise.equipment.length ? listEquipment(exercise.equipment, locale) : m.noneBodyweight}
              </Fact>
              <Fact label={m.patternFact}>
                <span className="inline-flex items-center gap-2">
                  <MovementSwatch group={exerciseGroup(exercise)} />
                  {movementLabel(exerciseGroup(exercise), locale)} · {patternLabel(exercise.pattern, locale)}
                </span>
              </Fact>
              <Fact label={m.levelFilter}>{levelLabel(exercise.level, locale)}</Fact>
              <Fact label={m.defaultFact}>
                {m.dose(
                  exercise.defaults.sets,
                  goal === 'strength' && exercise.defaults.strengthReps ? exercise.defaults.strengthReps : exercise.defaults.reps,
                  exercise.unit === 'seconds',
                )}
              </Fact>
              {exercise.laterality !== 'bilateral' && <Fact label={m.sidesFact}>{m.sides[exercise.laterality]}</Fact>}
            </dl>
          </Panel>
        </Section>

        <Section title={m.howTo}>
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

        <Section title={m.alternatives} description={m.alternativesDescription}>
          {alternatives.length ? (
            <Panel as="ul" className="divide-y divide-line px-3">
              {alternatives.map(({ exercise: alt, available: ok }) => (
                <li key={alt.id}>
                  <ExerciseRow
                    exercise={alt}
                    link
                    meta={ok ? undefined : m.needs(listEquipment(missing(alt), locale))}
                  />
                </li>
              ))}
            </Panel>
          ) : (
            <p className="px-1 text-sm text-ink-2">{m.noAlternatives}</p>
          )}
        </Section>

        <p className="mt-8 px-1 text-xs text-ink-3"><NotMedicalAdvice /></p>
      </PageBody>

      <StickyActions>
        {addTo !== undefined ? (
          <>
            <Button variant="primary" size="lg" block icon={CalendarPlus} onClick={() => addDirect(addTo)}>
              {m.addToDay(addTo)}
            </Button>
            <IconButton icon={CalendarDays} label={m.otherDays} variant="tonal" onClick={() => days.show()} />
          </>
        ) : (
          <Button variant="primary" size="lg" block icon={CalendarPlus} onClick={() => days.show()}>
            {m.addToPlan}
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

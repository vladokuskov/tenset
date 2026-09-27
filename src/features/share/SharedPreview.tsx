import { useLocation, useNavigate, useRouter } from '@tanstack/react-router'
import { Link2Off } from 'lucide-react'
import { useMemo } from 'react'
import { dayName } from '../../app/days'
import { countLabel, formatDaySummary, formatSets, setsLabel } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import { useWeek } from '../../app/useWeek'
import { decodeProgram, type DecodeError } from '../../domain/codec'
import { getGroup } from '../../domain/taxonomy'
import { useProgramStore } from '../../store/program.store'
import { Button, EmptyState, LinkButton, Page, PageBody, PageHeader, Panel, Section, StickyActions, showToast } from '../../ui'
import { BodyMini } from '../bodymap'
import { uniqueName } from './names'
import { exerciseName, isKnown } from './resolveNames'

const ERRORS: Record<DecodeError, string> = {
  empty: 'This link has no program in it.',
  malformed: 'This link is incomplete or was changed. Ask for a new one.',
  unsupported_version: 'This link was made by a newer version of the app. Reload to update, then try again.',
  invalid: 'This link holds a program this app cannot read.',
}

/** Read-only preview of a program from a share link. Saving always creates a new program. */
export function SharedPreview() {
  const hash = useLocation({ select: (l) => l.hash })
  const { catalog, replacedBy } = useCatalog()
  const result = useMemo(() => decodeProgram(hash, { replacedBy }), [hash, replacedBy])
  const program = result.ok ? result.program : null
  const view = useWeek(program)
  const importProgram = useProgramStore((s) => s.importProgram)
  const programs = useProgramStore((s) => s.programs)
  const navigate = useNavigate()
  const router = useRouter()

  const close = () => {
    if (router.history.canGoBack()) router.history.back()
    else void navigate({ to: '/', replace: true })
  }

  if (!result.ok || !view) {
    return (
      <Page>
        <PageHeader title="Shared program" back={{ to: '/', label: 'Plan' }} />
        <EmptyState
          icon={Link2Off}
          title="Could not open this link"
          actions={
            <LinkButton to="/" variant="primary">
              Go to Plan
            </LinkButton>
          }
        >
          {result.ok ? ERRORS.invalid : ERRORS[result.error]}
        </EmptyState>
      </Page>
    )
  }

  const { week, coverage, days, order } = view
  const shared = view.program
  const totalSets = days.reduce((s, d) => s + d.hardSets, 0)
  const trainingDays = days.filter((d) => d.kind === 'train').length
  const unknown = shared.days.flatMap((d) => d.entries).filter((e) => !isKnown(e.exerciseId, catalog, shared.custom)).length

  const save = () => {
    const name = uniqueName(shared.name, Object.values(programs).map((p) => p.name))
    const id = importProgram({ ...shared, name })
    if (!id) {
      showToast({ message: 'This program could not be saved.' })
      return
    }
    showToast({ message: `Saved "${name}" as a new program` })
    void navigate({ to: '/', replace: true })
  }

  return (
    <Page>
      <PageHeader title={shared.name} subtitle="Shared with you. Read only until you save it." back={{ to: '/', label: 'Plan' }} />
      <PageBody>
        <Panel className="flex items-center gap-4 p-4">
          <BodyMini view="both" groups={week.weekly} height={112} label="Week coverage of the shared program, front and back" />
          <div className="min-w-0">
            <p className="text-display font-light num">
              {coverage.trainedBanded}
              <span className="text-lg font-normal text-ink-3"> of {coverage.totalBanded}</span>
            </p>
            <p className="mt-1 text-sm text-ink-2">groups trained</p>
            <p className="mt-3 text-sm text-ink-2 num">
              {countLabel(trainingDays, 'training day')} · {formatSets(totalSets)} hard sets
            </p>
          </div>
        </Panel>
        {coverage.untrained.required.length > 0 && (
          <p className="mt-3 px-1 text-sm text-ink-2">
            Not trained: {coverage.untrained.required.map((u) => getGroup(u.group)?.name ?? u.group).join(', ')}
          </p>
        )}
        <p className="mt-2 px-1 text-sm text-ink-3">Numbers use your settings, so they can differ from what the sender sees.</p>

        <Section title="Week" className="mt-6">
          <Panel as="ul" className="divide-y divide-line">
            {order.map((d) => {
              const s = days[d]
              const entries = shared.days[d].entries
              return (
                <li key={d} className="px-4 py-3">
                  <div className="flex items-baseline gap-3">
                    <span className="w-10 shrink-0 font-semibold">{dayName(d)}</span>
                    <span className="min-w-0 flex-1 truncate">{s.kind === 'rest' ? 'Rest' : (s.label ?? 'Training')}</span>
                    {s.kind === 'train' && (
                      <span className="shrink-0 text-sm text-ink-2 num">{formatDaySummary(s.exercises, s.hardSets)}</span>
                    )}
                  </div>
                  {s.kind === 'train' && entries.length > 0 && (
                    <ul className="mt-2 space-y-1 pl-[3.25rem] text-sm">
                      {entries.map((e) => (
                        <li key={e.id} className="flex gap-3">
                          <span className="min-w-0 flex-1 text-ink">{exerciseName(e.exerciseId, catalog, shared.custom)}</span>
                          <span className="shrink-0 text-ink-2 num">
                            {e.reps ? `${e.sets} × ${e.reps}` : setsLabel(e.sets)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.note && <p className="mt-1.5 pl-[3.25rem] text-sm text-ink-3">{s.note}</p>}
                </li>
              )
            })}
          </Panel>
        </Section>
        {unknown > 0 && (
          <p className="mt-3 px-1 text-sm text-ink-2">
            {countLabel(unknown, 'exercise')} came from a newer catalog and will not count until the app updates.
          </p>
        )}
      </PageBody>
      <StickyActions>
        <Button variant="secondary" size="lg" onClick={close}>
          Close
        </Button>
        <Button variant="primary" size="lg" block onClick={save}>
          Save to my programs
        </Button>
      </StickyActions>
    </Page>
  )
}

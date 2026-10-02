import { Printer } from 'lucide-react'
import { Fragment, useEffect } from 'react'
import { notMedicalAdvice } from '../../app/brand'
import { dayName } from '../../app/days'
import { useCatalog } from '../../app/useCatalog'
import { useWeek } from '../../app/useWeek'
import { groupName } from '../../data/localize'
import { dateFormat } from '../../i18n/format'
import { useLocale, useMessages } from '../../i18n/messages'
import { BackButton, Button, EmptyState, LinkButton } from '../../ui'
import { BodyMap, VolumeLegend } from '../bodymap'
import { exerciseName } from '../share/resolveNames'
import { exportMessages } from './messages'

const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }
@media print {
  html, body { background: #fff !important; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  main#content { padding: 0 !important; }
  .print-sheet { max-width: none !important; padding: 0 !important; font-size: 9pt; line-height: 1.3; }
  .print-sheet h1 { font-size: 16pt; }
  .print-sheet table tbody { break-inside: avoid; }
}
`

// Dark mode tokens would print light text on white paper, so force the light theme while printing.
function useLightThemeForPrint() {
  useEffect(() => {
    const root = document.documentElement
    let previous: string | undefined
    const before = () => {
      previous = root.dataset.theme
      root.dataset.theme = 'light'
    }
    const after = () => {
      if (previous === undefined) delete root.dataset.theme
      else root.dataset.theme = previous
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])
}

/** Clean one-page week: table of days and exercises, front/back map, footer. */
export function PrintPage() {
  const view = useWeek()
  const { catalog } = useCatalog()
  const m = useMessages(exportMessages)
  const locale = useLocale()
  useLightThemeForPrint()

  if (!view) {
    return (
      <div className="min-h-dvh pb-chrome">
        <EmptyState
          title={m.nothingToPrint}
          actions={
            <LinkButton to="/welcome" variant="primary">
              {m.createPlan}
            </LinkButton>
          }
        >
          {m.createFirst}
        </EmptyState>
      </div>
    )
  }

  const { program, week, coverage, days, order } = view
  const totalSets = days.reduce((s, d) => s + d.hardSets, 0)
  const trainingDays = days.filter((d) => d.kind === 'train').length
  const untrained = coverage.untrained.required.map((u) => groupName(u.group, locale))

  return (
    <div className="min-h-dvh pb-chrome print:min-h-0 print:pb-0">
      <style>{PRINT_CSS}</style>
      <div className="glass sticky top-0 z-30 pt-safe print:hidden">
        <div className="mx-auto flex h-13 w-full max-w-[var(--page-max)] items-center gap-2 px-gutter">
          <div className="min-w-0 flex-1">
            <BackButton to="/" label={m.plan} />
          </div>
          <Button variant="primary" size="sm" icon={Printer} onClick={() => window.print()}>
            {m.print}
          </Button>
        </div>
      </div>

      <article className="print-sheet mx-auto w-full max-w-[var(--page-max)] px-gutter pb-6 pt-2 text-ink">
        <header className="border-b border-ink pb-2">
          <h1 className="text-xl font-bold tracking-[-0.01em]">{program.name}</h1>
          <p className="mt-0.5 text-sm text-ink-2 num">
            {m.header(trainingDays, totalSets, dateFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()))}
          </p>
        </header>

        <div className="mt-4 grid gap-6 print:mt-3 print:grid-cols-[1fr_68mm] print:gap-5 sm:grid-cols-[1fr_12rem]">
          <table className="w-full border-collapse text-left text-sm print:text-[9pt]">
            <thead>
              <tr className="border-b border-line-strong text-xs uppercase tracking-wide text-ink-2">
                <th scope="col" className="w-14 py-1.5 pr-2 font-semibold">{m.day}</th>
                <th scope="col" className="py-1.5 pr-2 font-semibold">{m.exercise}</th>
                <th scope="col" className="w-10 py-1.5 pr-2 text-right font-semibold">{m.sets}</th>
                <th scope="col" className="w-14 py-1.5 font-semibold">{m.reps}</th>
              </tr>
            </thead>
            {order.map((d) => {
              const s = days[d]
              const entries = s.kind === 'train' ? program.days[d].entries : []
              const span = Math.max(1, entries.length + (entries.length && s.note ? 1 : 0))
              const dayCell = (
                <th scope="rowgroup" rowSpan={span} className="py-1.5 pr-2 align-top font-semibold">
                  {dayName(d, 'short', locale)}
                  {s.label && <span className="block text-xs font-normal text-ink-2">{s.label}</span>}
                </th>
              )
              return (
                <tbody key={d} className="border-b border-line">
                  {entries.length === 0 ? (
                    <tr>
                      {dayCell}
                      <td colSpan={3} className="py-1.5 text-ink-3">
                        {s.kind === 'rest' ? m.rest : m.noExercisesYet}
                        {s.note && <span className="ml-2 text-ink-2">{s.note}</span>}
                      </td>
                    </tr>
                  ) : (
                    entries.map((e, i) => (
                      <Fragment key={e.id}>
                        <tr>
                          {i === 0 && dayCell}
                          <td className="py-1 pr-2">{exerciseName(e.exerciseId, catalog, program.custom, locale)}</td>
                          <td className="py-1 pr-2 text-right num">{e.sets}</td>
                          <td className="py-1 num">{e.reps ?? ''}</td>
                        </tr>
                        {i === entries.length - 1 && s.note && (
                          <tr>
                            <td colSpan={3} className="pb-1.5 text-xs text-ink-2">
                              {m.note(s.note)}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))
                  )}
                </tbody>
              )
            })}
          </table>

          <aside className="min-w-0">
            <BodyMap
              view="both"
              values={{ heads: week.shade.weekly, groups: week.weekly }}
              scale="week"
              label={m.mapLabel}
              className="mx-auto max-w-[16rem]"
            />
            <VolumeLegend scale="week" className="mt-3" />
            <p className="mt-3 text-sm print:text-[8.5pt]">
              <span className="num font-semibold">
                {m.countOf(coverage.trainedBanded, coverage.totalBanded)}
              </span>{' '}
              {m.groupsTrained}
              {untrained.length > 0 && <span className="text-ink-2">{m.notTrained(untrained.join(', '))}</span>}
            </p>
          </aside>
        </div>

        <footer className="mt-6 border-t border-line pt-2 text-xs text-ink-2 print:mt-4 print:text-[7.5pt]">
          {m.footer(notMedicalAdvice(locale))}
        </footer>
      </article>
    </div>
  )
}

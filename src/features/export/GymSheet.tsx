import { dayName } from '../../app/days'
import { formatRest, formatRir, joinMeta } from '../../app/format'
import type { WeekView } from '../../app/useWeek'
import type { Catalog } from '../../domain/resolve'
import { common } from '../../i18n/common'
import { useLocale, useMessages } from '../../i18n/messages'
import { defaultReps, repsText, supersetLabels, unitOf } from '../builder/labels'
import { exerciseFor } from '../builder/lookup'
import { exerciseName } from '../share/resolveNames'
import { exportMessages } from './messages'

/** One block per training day: each exercise with its targets and an empty box per set, for writing by hand. */
export function GymSheet({ view, catalog }: { view: WeekView; catalog: Catalog }) {
  const m = useMessages(exportMessages)
  const locale = useLocale()
  const c = common[locale]
  const { program, order, prefs } = view
  const days = order.filter((d) => program.days[d].kind === 'train' && program.days[d].entries.length > 0)

  if (!days.length) return <p className="mt-4 text-sm text-ink-2">{m.gymEmpty}</p>

  return (
    <div className="mt-3 space-y-5 print:space-y-4">
      <p className="text-sm text-ink-2 print:text-[8.5pt]">{m.gymHint}</p>
      {days.map((d) => {
        const day = program.days[d]
        const pairs = supersetLabels(day.entries)
        const label = view.days[d].label
        return (
          <section key={d} data-gym-day={d} className="break-inside-avoid border-t border-ink pt-2">
            <header className="flex items-baseline justify-between gap-3">
              <h2 className="min-w-0 text-base font-semibold">
                {dayName(d, 'long', locale)}
                {label && <span className="font-normal text-ink-2"> · {label}</span>}
              </h2>
              <span className="shrink-0 text-xs text-ink-2">
                {m.gymDate} <span className="inline-block w-20 border-b border-line-strong" aria-hidden />
              </span>
            </header>
            {day.note && <p className="mt-0.5 text-xs text-ink-2">{m.note(day.note)}</p>}
            <ol className="mt-1.5 divide-y divide-line">
              {day.entries.map((e, i) => {
                const ex = exerciseFor(e.exerciseId, catalog, program)
                const reps = e.reps ?? (ex ? defaultReps(ex, prefs.goal) : undefined)
                const target = joinMeta([
                  c.sets(e.sets),
                  reps && repsText(reps, ex ? unitOf(ex) : 'reps', locale),
                  e.restSec !== undefined && m.restPart(formatRest(e.restSec, locale)),
                  e.rir !== undefined && formatRir(e.rir, locale),
                ])
                return (
                  <li key={e.id} className="break-inside-avoid gap-3 py-1.5 sm:flex sm:items-center print:flex print:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {pairs[i] && <span className="mr-1.5 font-semibold num">{pairs[i].label}</span>}
                        {exerciseName(e.exerciseId, catalog, program.custom, locale)}
                      </p>
                      <p className="text-xs text-ink-2 num">{target}</p>
                      {e.note && <p className="text-xs text-ink-2">{m.note(e.note)}</p>}
                    </div>
                    <div
                      className="mt-1 flex flex-wrap gap-1.5 sm:mt-0 sm:max-w-[60%] sm:justify-end print:mt-0 print:max-w-[60%] print:justify-end"
                      role="img"
                      aria-label={m.setBoxes(e.sets)}
                    >
                      {Array.from({ length: e.sets }, (_, k) => (
                        <span
                          key={k}
                          className="relative flex h-9 w-20 items-center justify-center rounded-sm border border-ink-3 text-ink-3 print:h-[9mm] print:w-[19mm]"
                        >
                          <span className="absolute left-1 top-0.5 text-[9px] leading-none num">{k + 1}</span>
                          <span className="text-xs">×</span>
                        </span>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        )
      })}
    </div>
  )
}

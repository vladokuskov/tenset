import { Link, getRouteApi } from '@tanstack/react-router'
import { BedDouble, Ellipsis, Plus } from 'lucide-react'
import { useState } from 'react'
import { dayFromSlug, dayName, daySlug } from '../../app/days'
import { formatDaySummary, joinMeta } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import { useWeek } from '../../app/useWeek'
import { common } from '../../i18n/common'
import { useLocale } from '../../i18n/messages'
import { useProgramStore } from '../../store/program.store'
import { CustomExerciseSheet } from '../settings/CustomExerciseSheet'
import { Button, EmptyState, IconButton, Page, PageBody, PageHeader, StickyActions, cx, useSheet } from '../../ui'
import { AddSheet, type AddTab } from './AddSheet'
import { DayOptionsSheet } from './DayOptionsSheet'
import { EntryList } from './EntryList'
import { EntrySheets } from './EntrySheets'
import { exerciseFor } from './lookup'
import { builderMessages } from './messages'
import { NoProgram } from './NoProgram'
import { ThisDayCard } from './ThisDayCard'
import { useChange } from './useChange'

const route = getRouteApi('/day/$dow')

export function DayScreen() {
  const { dow } = route.useParams()
  const search = route.useSearch()
  const day = dayFromSlug(dow)
  const view = useWeek()
  const { catalog } = useCatalog()
  const setTrain = useProgramStore((s) => s.setTrain)
  const setRest = useProgramStore((s) => s.setRest)
  const change = useChange()
  const add = useSheet('add', ['tab', 'group'])
  const entry = useSheet('entry', ['entry'])
  const reps = useSheet('reps', ['entry'])
  const options = useSheet('day')
  const custom = useSheet('custom', ['id'])
  const [customName, setCustomName] = useState('')
  const locale = useLocale()
  const m = builderMessages[locale]
  const c = common[locale]

  if (!view) return <NoProgram />
  const { program, order, days } = view
  const d = program.days[day]
  const summary = days[day]
  const rest = d.kind === 'rest'
  const name = dayName(day, 'long', locale)

  return (
    <Page>
      <PageHeader
        title={summary.label ? `${name} · ${summary.label}` : name}
        subtitle={rest ? m.restDay : formatDaySummary(summary.exercises, summary.hardSets, locale, summary.estMinutes)}
        back={{ to: '/', label: m.plan }}
        actions={<IconButton icon={Ellipsis} label={m.dayOptionsFor(name)} onClick={() => options.show()} />}
      >
        <nav aria-label={m.days} className="flex gap-1.5 py-1">
          {order.map((i) => {
            const s = days[i]
            const current = i === day
            return (
              <Link
                key={i}
                to="/day/$dow"
                params={{ dow: daySlug(i) }}
                replace
                aria-current={current ? 'page' : undefined}
                aria-label={m.dayLink(i, s.kind === 'rest' ? null : formatDaySummary(s.exercises, s.hardSets, locale, s.estMinutes))}
                className={cx(
                  'hit flex h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-full border px-1 text-sm font-medium leading-none transition-colors',
                  current ? 'border-ink bg-ink text-on-ink' : 'border-line-strong text-ink hover:bg-surface-2',
                  s.kind === 'rest' && !current && 'border-dashed text-ink-3',
                )}
              >
                <span>{dayName(i, 'short', locale)}</span>
                <span className={cx('num mt-1 text-[0.6875rem] font-normal', current ? 'text-on-ink/70' : 'text-ink-3')}>
                  {s.kind === 'rest' ? m.restShort : s.exercises}
                </span>
              </Link>
            )
          })}
        </nav>
      </PageHeader>

      <PageBody className="space-y-4">
        {d.note && <p className="rounded-xl bg-surface px-4 py-3 text-sm text-ink-2">{d.note}</p>}

        {rest ? (
          <div className="rounded-xl bg-surface">
            <EmptyState
              icon={BedDouble}
              title={m.restDay}
              actions={
                <Button variant="primary" onClick={() => change(m.isTrainingDay(day), () => setTrain(day))}>
                  {m.makeTraining}
                </Button>
              }
            >
              {d.entries.length > 0
                ? m.keptOnRest(d.entries.length)
                : m.restEmpty}
            </EmptyState>
            {d.entries.length > 0 && (
              <ul className="border-t border-line px-4 py-2 text-sm text-ink-2">
                {d.entries.map((e) => (
                  <li key={e.id} className="py-1">
                    {joinMeta([exerciseFor(e.exerciseId, catalog, program)?.name ?? m.unknownExercise, m.setsPlain(e.sets)])}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            <ThisDayCard view={view} day={day} />
            {d.entries.length === 0 ? (
              <div className="rounded-xl bg-surface">
                <EmptyState
                  title={c.noExercisesYet}
                  actions={
                    <>
                      <Button variant="primary" icon={Plus} onClick={() => add.show()}>
                        {m.addExercise}
                      </Button>
                      <Button onClick={() => change(m.isRestDay(day), () => setRest(day))}>{m.makeRest}</Button>
                    </>
                  }
                >
                  {m.emptyTraining}
                </EmptyState>
              </div>
            ) : (
              <EntryList
                program={program}
                day={day}
                onOpen={(id) => entry.show({ entry: id })}
                onOpenReps={(id) => reps.show({ entry: id })}
              />
            )}
          </>
        )}
      </PageBody>

      <StickyActions>
        <Button variant="primary" size="lg" block icon={Plus} onClick={() => add.show()}>
          {m.addExercise}
        </Button>
      </StickyActions>

      <AddSheet
        open={add.open}
        day={day}
        tab={search.tab as AddTab | undefined}
        group={search.group}
        onParams={(p) => add.update(p)}
        onClose={add.close}
        onCreateCustom={(name) => {
          setCustomName(name)
          add.switchTo('custom', { id: 'new' })
        }}
      />
      {/* Saving or cancelling returns to the add sheet in the same history entry; back leaves both. */}
      <CustomExerciseSheet id={search.id} open={custom.open} onClose={() => custom.switchTo('add')} initialName={customName} />
      <EntrySheets />
      <DayOptionsSheet day={day} open={options.open} onClose={options.close} />
    </Page>
  )
}

import { Link, getRouteApi } from '@tanstack/react-router'
import { BedDouble, Ellipsis, Plus } from 'lucide-react'
import { useState } from 'react'
import { dayFromSlug, dayName, daySlug } from '../../app/days'
import { countLabel, formatDaySummary, joinMeta } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import { useWeek } from '../../app/useWeek'
import { useProgramStore } from '../../store/program.store'
import { CustomExerciseSheet } from '../settings/CustomExerciseSheet'
import { Button, EmptyState, IconButton, Page, PageBody, PageHeader, StickyActions, cx, useSheet } from '../../ui'
import { AddSheet, type AddTab } from './AddSheet'
import { DayOptionsSheet } from './DayOptionsSheet'
import { EntryList } from './EntryList'
import { EntrySheets } from './EntrySheets'
import { exerciseFor } from './lookup'
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
  const options = useSheet('day')
  const custom = useSheet('custom', ['id'])
  const [customName, setCustomName] = useState('')

  if (!view) return <NoProgram />
  const { program, order, days } = view
  const d = program.days[day]
  const summary = days[day]
  const rest = d.kind === 'rest'
  const name = dayName(day, 'long')

  return (
    <Page>
      <PageHeader
        title={d.label ? `${name} · ${d.label}` : name}
        subtitle={rest ? 'Rest day' : formatDaySummary(summary.exercises, summary.hardSets)}
        back={{ to: '/', label: 'Plan' }}
        actions={<IconButton icon={Ellipsis} label={`${name} options`} onClick={() => options.show()} />}
      >
        <nav aria-label="Days" className="flex gap-1.5 py-1">
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
                aria-label={`${dayName(i, 'long')}, ${s.kind === 'rest' ? 'rest' : formatDaySummary(s.exercises, s.hardSets)}`}
                className={cx(
                  'hit flex h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-full border px-1 text-sm font-medium leading-none transition-colors',
                  current ? 'border-ink bg-ink text-on-ink' : 'border-line-strong text-ink hover:bg-surface-2',
                  s.kind === 'rest' && !current && 'border-dashed text-ink-3',
                )}
              >
                <span>{dayName(i)}</span>
                <span className={cx('num mt-1 text-[0.6875rem] font-normal', current ? 'text-on-ink/70' : 'text-ink-3')}>
                  {s.kind === 'rest' ? 'Rest' : s.exercises}
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
              title="Rest day"
              actions={
                <Button variant="primary" onClick={() => change(`${name} is a training day`, () => setTrain(day))}>
                  Make it a training day
                </Button>
              }
            >
              {d.entries.length > 0
                ? `${countLabel(d.entries.length, 'exercise')} ${d.entries.length === 1 ? 'is' : 'are'} kept here and count again when this is a training day.`
                : 'Nothing counts on a rest day. Adding an exercise turns it into a training day.'}
            </EmptyState>
            {d.entries.length > 0 && (
              <ul className="border-t border-line px-4 py-2 text-sm text-ink-2">
                {d.entries.map((e) => (
                  <li key={e.id} className="py-1">
                    {joinMeta([exerciseFor(e.exerciseId, catalog, program)?.name ?? 'Unknown exercise', `${e.sets} sets`])}
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
                  title="No exercises yet"
                  actions={
                    <>
                      <Button variant="primary" icon={Plus} onClick={() => add.show()}>
                        Add exercise
                      </Button>
                      <Button onClick={() => change(`${name} is a rest day`, () => setRest(day))}>Make it a rest day</Button>
                    </>
                  }
                >
                  An empty training day is not a rest day. Add exercises, or mark it as rest.
                </EmptyState>
              </div>
            ) : (
              <EntryList program={program} day={day} onOpen={(id) => entry.show({ entry: id })} />
            )}
          </>
        )}
      </PageBody>

      <StickyActions>
        <Button variant="primary" size="lg" block icon={Plus} onClick={() => add.show()}>
          Add exercise
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

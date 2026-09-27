import { getRouteApi } from '@tanstack/react-router'
import { ChevronDown, Ellipsis } from 'lucide-react'
import { useEffect } from 'react'
import { NOT_MEDICAL_ADVICE } from '../../app/brand'
import { dayFromSlug, daySlug, todayIndex } from '../../app/days'
import { useWeek } from '../../app/useWeek'
import { ExportDialog } from '../export'
import { ProgramsSheet } from '../programs'
import { ShareDialog } from '../share'
import { InstallNudge } from '../../sw'
import { Button, IconButton, Page, PageBody, PageHeader, Section, useSheet } from '../../ui'
import { AddSheet } from './AddSheet'
import { CoverageCard } from './CoverageCard'
import { NoProgram } from './NoProgram'
import { PlanMenu } from './PlanMenu'
import { BOARD_QUERY, DesktopPlan } from './desktop/DesktopPlan'
import { DESKTOP_QUERY, useMediaQuery } from './useMediaQuery'
import { WeekList } from './WeekList'

const route = getRouteApi('/')

export function PlanScreen() {
  const view = useWeek()
  const search = route.useSearch()
  const desktop = useMediaQuery(BOARD_QUERY)
  const wide = useMediaQuery(DESKTOP_QUERY)
  const menu = useSheet('menu')
  const programs = useSheet('programs')
  const share = useSheet('share')
  const transfer = useSheet('export')
  const add = useSheet('add', ['day', 'tab', 'group'])
  const { open: mapOpen, close: closeMap } = useSheet('map')

  // The week map sheet (DesktopPlan) only exists at 1024-1279. Drop it outside that range so back never lands on a
  // hidden sheet and resizing into the range again does not reopen it.
  useEffect(() => {
    if (mapOpen && (!desktop || wide)) closeMap()
  }, [mapOpen, desktop, wide, closeMap])

  const firstTraining = view?.order.find((d) => view.days[d].kind === 'train') ?? todayIndex()
  const addDay = search.day ? dayFromSlug(search.day) : firstTraining

  const sheets = (
    <>
      <PlanMenu
        open={menu.open}
        onClose={menu.close}
        onShare={() => menu.switchTo('share')}
        onExport={() => menu.switchTo('export')}
      />
      <ShareDialog open={share.open} onClose={share.close} />
      <ExportDialog open={transfer.open} onClose={transfer.close} />
      <ProgramsSheet open={programs.open} onClose={programs.close} />
      {view && (
        <AddSheet
          open={add.open}
          day={addDay}
          tab={search.tab}
          group={search.group}
          onParams={(p) => add.update(p)}
          onClose={add.close}
        />
      )}
    </>
  )

  if (!view) {
    return (
      <>
        <NoProgram />
        {sheets}
      </>
    )
  }

  const title = (
    <button
      type="button"
      onClick={() => programs.show()}
      className="hit -ml-1 inline-flex max-w-full items-center gap-1 rounded-md px-1 text-left"
    >
      <span className="truncate">{view.program.name}</span>
      <ChevronDown size={22} strokeWidth={2} className="shrink-0 text-ink-3" aria-hidden />
      <span className="sr-only">, switch program</span>
    </button>
  )
  const more = <IconButton icon={Ellipsis} label="More" onClick={() => menu.show()} />
  const header = <PageHeader title={title} actions={more} />

  if (desktop) {
    return (
      <DesktopPlan view={view} title={title} actions={more} onAdd={(d) => add.show({ day: daySlug(d), tab: undefined, group: undefined })}>
        {sheets}
      </DesktopPlan>
    )
  }

  return (
    <Page>
      {header}
      <PageBody>
        <CoverageCard view={view} />
        <InstallNudge className="mt-3" />
        {view.week.entries.length === 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
            <p className="text-sm text-ink-2">Start faster from a split template.</p>
            <Button size="sm" variant="primary" onClick={() => programs.show()}>
              Use a template
            </Button>
          </div>
        )}
        <Section title="Week" className="mt-6">
          <WeekList view={view} />
        </Section>
        <p className="mt-6 px-1 text-xs text-ink-3">{NOT_MEDICAL_ADVICE}</p>
      </PageBody>
      {sheets}
    </Page>
  )
}

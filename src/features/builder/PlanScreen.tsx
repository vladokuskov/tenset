import { getRouteApi, Link } from '@tanstack/react-router'
import { ChevronDown, ClipboardPaste, Ellipsis, Printer } from 'lucide-react'
import { useEffect } from 'react'
import { NotMedicalAdvice } from '../../app/brand'
import { dayFromSlug, daySlug, todayIndex } from '../../app/days'
import { useWeek } from '../../app/useWeek'
import { useMessages } from '../../i18n/messages'
import { InstallNudge } from '../../sw'
import { Button, buttonClass, IconButton, Page, PageBody, PageHeader, Section, useSheet } from '../../ui'
import { DESKTOP_QUERY, useMediaQuery } from '../../ui/useMediaQuery'
import { CalendarSheet, ExportDialog, ImageSheet, PasteSheet } from '../export'
import { ProgramsSheet } from '../programs'
import { ShareDialog } from '../share'
import { AddSheet } from './AddSheet'
import { CoverageCard } from './CoverageCard'
import { BOARD_QUERY, DesktopPlan } from './desktop/DesktopPlan'
import { builderMessages } from './messages'
import { NoProgram } from './NoProgram'
import { PlanMenu } from './PlanMenu'
import { WeekList } from './WeekList'

const route = getRouteApi('/')

export function PlanScreen() {
  const view = useWeek()
  const m = useMessages(builderMessages)
  const search = route.useSearch()
  const desktop = useMediaQuery(BOARD_QUERY)
  const wide = useMediaQuery(DESKTOP_QUERY)
  const menu = useSheet('menu')
  const programs = useSheet('programs')
  const share = useSheet('share')
  const transfer = useSheet('export')
  const paste = useSheet('paste')
  const image = useSheet('image')
  const calendar = useSheet('calendar')
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
        onPaste={() => menu.switchTo('paste')}
        onImage={() => menu.switchTo('image')}
        onCalendar={() => menu.switchTo('calendar')}
      />
      <ShareDialog open={share.open} onClose={share.close} />
      <ExportDialog open={transfer.open} onClose={transfer.close} onPaste={() => transfer.switchTo('paste')} />
      <PasteSheet open={paste.open} onClose={paste.close} />
      <ImageSheet open={image.open} onClose={image.close} />
      <CalendarSheet open={calendar.open} onClose={calendar.close} />
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
      <span className="sr-only">{m.switchProgram}</span>
    </button>
  )
  const more = <IconButton icon={Ellipsis} label={m.more} onClick={() => menu.show()} />
  const header = <PageHeader title={title} compactTitle={view.program.name} actions={more} settings />

  if (desktop) {
    // The board has room for the two actions people look for first; the rest stay in the menu.
    const actions = (
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" icon={ClipboardPaste} onClick={() => paste.show()}>
          {m.menu.paste}
        </Button>
        <Link to="/print" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
          <Printer size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
          {m.menu.print}
        </Link>
        {more}
      </div>
    )
    return (
      <DesktopPlan view={view} title={title} actions={actions} onAdd={(d) => add.show({ day: daySlug(d), tab: undefined, group: undefined })}>
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
            <p className="text-sm text-ink-2">{m.templateNudge}</p>
            <Button size="sm" variant="primary" onClick={() => programs.show()}>
              {m.useTemplate}
            </Button>
          </div>
        )}
        <Section title={m.week} className="mt-6">
          <WeekList view={view} />
        </Section>
        <p className="mt-6 px-1 text-xs text-ink-3"><NotMedicalAdvice /></p>
      </PageBody>
      {sheets}
    </Page>
  )
}

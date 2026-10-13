import { PersonStanding } from 'lucide-react'
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { DayIndex } from '../../../app/days'
import { useCatalog } from '../../../app/useCatalog'
import type { WeekView } from '../../../app/useWeek'
import { resolveExercise, type ResolveContext } from '../../../domain/resolve'
import { useMessages } from '../../../i18n/messages'
import { usePrefsStore } from '../../../store/prefs.store'
import { useProgramStore } from '../../../store/program.store'
import { InstallNudge } from '../../../sw'
import { IconButton, Page, PageBody, PageHeader, Sheet, useScrollFade, useSheet } from '../../../ui'
import { DESKTOP_QUERY, useMediaQuery, writeFlag } from '../../../ui/useMediaQuery'
import { defaultReps, defaultSets, type AnyExercise } from '../../shared/exercise'
import { useChange } from '../../shared/useChange'
import { WeekBoard, type BoardHighlight } from '../WeekBoard'
import { CatalogDrawer, DrawerStrip } from './CatalogDrawer'
import { entriesTraining, type Focus } from './coupling'
import { DeskMapPanel } from './DeskMapPanel'
import { desktopMessages } from './messages'

/** From here up the Plan is the week board; below it the phone layout. */
export const BOARD_QUERY = '(min-width: 64rem)'
// Width at which drawer, board and map panel all fit with readable columns; the drawer starts open here.
const ROOMY_QUERY = '(min-width: 106rem)'
const DRAWER_KEY = 'gb:desk-drawer'
// The page is one screen tall; the board row takes what the header leaves and its parts scroll inside.
const FILL = 'flex min-h-0 flex-1 flex-col'

function readDrawer(): boolean | null {
  try {
    const v = localStorage.getItem(DRAWER_KEY)
    return v === null ? null : v === '1'
  } catch {
    return null
  }
}

export type DesktopPlanProps = {
  view: WeekView
  /** Page title (the program switcher) and trailing header actions from the Plan screen. */
  title: ReactNode
  actions: ReactNode
  /** Opens the add sheet for a day (board column "Add"). */
  onAdd: (day: DayIndex) => void
  /** Sheets hosted by the Plan route. */
  children?: ReactNode
}

/**
 * Plan from 1024px: the week board with the map as an overlay sheet (?sheet=map), and from 1280px
 * a catalog drawer, the board and a sticky map panel, coupled by hover and focus in both directions.
 */
export function DesktopPlan({ view, title, actions, onAdd, children }: DesktopPlanProps) {
  const wide = useMediaQuery(DESKTOP_QUERY)
  const roomy = useMediaQuery(ROOMY_QUERY)
  const { catalog } = useCatalog()
  const countingMode = usePrefsStore((s) => s.countingMode)
  const overrides = usePrefsStore((s) => s.overrides)
  const goal = usePrefsStore((s) => s.goal)
  const addEntries = useProgramStore((s) => s.addEntries)
  const change = useChange()
  const map = useSheet('map')
  const m = useMessages(desktopMessages)

  const fadeRef = useScrollFade<HTMLElement>()
  const [drawerPref, setDrawerPref] = useState(readDrawer)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [dragGroups, setDragGroups] = useState<string[] | null>(null)
  const [addDay, setAddDay] = useState<DayIndex | null>(null)

  const { program, order } = view
  const ctx = useMemo<ResolveContext>(
    () => ({ catalog, custom: program.custom, countingMode, overrides }),
    [catalog, program.custom, countingMode, overrides],
  )
  const shown = useMemo<Focus | null>(() => (dragGroups ? { kind: 'entry', groups: dragGroups } : focus), [dragGroups, focus])
  const litGroup = shown?.kind === 'group' ? shown.group : null
  const lit = useMemo(() => (litGroup ? entriesTraining(program, litGroup, ctx) : []), [litGroup, program, ctx])
  const highlight = useMemo<BoardHighlight | null>(
    () => (litGroup ? Object.fromEntries(lit.map((e) => [e.id, e.role])) : null),
    [litGroup, lit],
  )

  const drawerOpen = drawerPref ?? roomy
  const setDrawer = (open: boolean) => {
    setDrawerPref(open)
    writeFlag(DRAWER_KEY, open)
  }
  const firstTraining = order.find((d) => program.days[d].kind === 'train') ?? order[0]
  const targetDay = addDay ?? firstTraining

  const onEntryHover = (groups: string[] | null) => setFocus(groups ? { kind: 'entry', groups } : null)
  const onFocusGroup = (group: string | null) => setFocus(group ? { kind: 'group', group } : null)
  const add = (e: AnyExercise, day: DayIndex) =>
    change(m.addedTo(e.name, day), () => addEntries(day, [e.id], defaultSets(e), defaultReps(e, goal)))
  const onDragExercise = (e: AnyExercise | null) => {
    setFocus(null)
    setDragGroups(
      e
        ? Object.entries(resolveExercise(e.id, ctx)?.groups ?? {})
            .filter(([, g]) => g.role === 'primary')
            .map(([id]) => id)
        : null,
    )
  }

  const panel = <DeskMapPanel view={view} focus={shown} lit={lit} onFocusGroup={onFocusGroup} title={wide} />

  const header = (
    <PageHeader
      title={title}
      compactTitle={view.program.name}
      actions={
        <>
          {!wide && (
            <IconButton
              icon={PersonStanding}
              label={m.weekMap}
              aria-haspopup="dialog"
              aria-expanded={map.open}
              onClick={() => map.show()}
            />
          )}
          {actions}
        </>
      }
    />
  )

  if (!wide) {
    return (
      <Page width="wide" fit>
        {header}
        <PageBody className={FILL}>
          <InstallNudge className="mb-4" />
          <WeekBoard view={view} onAdd={onAdd} onHover={onEntryHover} highlight={highlight} />
        </PageBody>
        <Sheet open={map.open} onClose={map.close} title={m.thisWeek} className="backdrop:bg-scrim/40">
          {panel}
        </Sheet>
        {children}
      </Page>
    )
  }

  const drawer = drawerOpen ? (
    <CatalogDrawer
      custom={program.custom}
      order={order}
      day={targetDay}
      onDay={setAddDay}
      onAdd={add}
      onPreview={onEntryHover}
      onCollapse={() => setDrawer(false)}
    />
  ) : (
    <DrawerStrip onExpand={() => setDrawer(true)} />
  )

  return (
    <Page width="wide" fit>
      <div className={FILL} style={{ '--page-max': '120rem' } as CSSProperties}>
        {header}
        <PageBody className={FILL}>
          <InstallNudge className="mb-4" />
          <div className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)_19rem] gap-4 min-[120rem]:grid-cols-[auto_minmax(0,1fr)_25rem]">
            <WeekBoard
              view={view}
              onAdd={onAdd}
              onHover={onEntryHover}
              highlight={highlight}
              drawer={drawer}
              onDropExercise={drawerOpen ? add : undefined}
              onDragExercise={onDragExercise}
            />
            <aside ref={fadeRef} aria-label={m.weekMap} className="scroll-fade scrollbar-thin min-h-0 overflow-y-auto overscroll-contain rounded-xl">
              {panel}
            </aside>
          </div>
        </PageBody>
      </div>
      {children}
    </Page>
  )
}

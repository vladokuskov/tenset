import { DragDropProvider, DragOverlay, PointerSensor } from '@dnd-kit/react'
import { PersonStanding } from 'lucide-react'
import { useMemo, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import { dayName, type DayIndex } from '../../../app/days'
import { plural } from '../../../app/format'
import { useCatalog } from '../../../app/useCatalog'
import type { WeekView } from '../../../app/useWeek'
import { resolveExercise, type ResolveContext } from '../../../domain/resolve'
import { usePrefsStore } from '../../../store/prefs.store'
import { useProgramStore } from '../../../store/program.store'
import { InstallNudge } from '../../../sw'
import { IconButton, Page, PageBody, PageHeader, Sheet } from '../../../ui'
import { defaultReps, defaultSets, type AnyExercise } from '../labels'
import { useChange } from '../useChange'
import { DESKTOP_QUERY, useMediaQuery, writeFlag } from '../useMediaQuery'
import { WeekBoard } from '../WeekBoard'
import { DROP_CSS, type DayDropData, type DrawerDragData } from './board'
import { CatalogDrawer, DrawerStrip } from './CatalogDrawer'
import { entriesTraining, litCss, type Focus } from './coupling'
import { DayDrops } from './DayDrops'
import { DeskMapPanel } from './DeskMapPanel'

/** From here up the Plan is the week board; below it the phone layout. */
export const BOARD_QUERY = '(min-width: 64rem)'
// Width at which drawer, board and map panel all fit with readable columns; the drawer starts open here.
const ROOMY_QUERY = '(min-width: 106rem)'
const DRAWER_KEY = 'gb:desk-drawer'
const SCOPE = '[data-desk-board]'
const STICKY = 'sticky top-[calc(var(--safe-top)+4rem)] self-start'

type PluginList = Extract<NonNullable<ComponentProps<typeof DragDropProvider>['plugins']>, readonly unknown[]>

// Drawer drags are pointer only (the "+" buttons are the keyboard path), so drop the accessibility
// plugin, which would make every row an inert tab stop. Found as in ../dnd.tsx.
const isAccessibilityPlugin = (p: unknown) =>
  typeof p === 'function' && Function.prototype.toString.call(p).includes('screenReaderInstructions')
const plugins = (defaults: PluginList): PluginList => defaults.filter((p) => !isAccessibilityPlugin(p)) as PluginList
const sensors = [PointerSensor]

function readDrawer(): boolean | null {
  try {
    const v = localStorage.getItem(DRAWER_KEY)
    return v === null ? null : v === '1'
  } catch {
    return null
  }
}

function DragCard({ exercise }: { exercise: AnyExercise }) {
  const sets = defaultSets(exercise)
  return (
    <div className="flex h-full w-full flex-col justify-center rounded-lg border border-line-strong bg-raised px-3 py-2 shadow-float">
      <span className="line-clamp-2 text-sm font-medium leading-snug text-ink">{exercise.name}</span>
      <span className="num mt-0.5 block text-xs text-ink-2">
        {sets} {plural(sets, 'set')}
      </span>
    </div>
  )
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
 * Plan from 1024px: the week board with the map as an overlay, and from 1280px a catalog drawer,
 * the board and a sticky map panel, coupled by hover and focus in both directions.
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
  const boardRef = useRef<HTMLDivElement>(null)

  const [mapOpen, setMapOpen] = useState(false)
  const [drawerPref, setDrawerPref] = useState(readDrawer)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [dragGroups, setDragGroups] = useState<string[] | null>(null)
  const [addDay, setAddDay] = useState<DayIndex | null>(null)
  // The inline panel replaces the overlay from 1280px; do not reopen it when the window narrows again.
  if (wide && mapOpen) setMapOpen(false)

  const { program, order } = view
  const ctx = useMemo<ResolveContext>(
    () => ({ catalog, custom: program.custom, countingMode, overrides }),
    [catalog, program.custom, countingMode, overrides],
  )
  const shown = useMemo<Focus | null>(() => (dragGroups ? { kind: 'entry', groups: dragGroups } : focus), [dragGroups, focus])
  const litGroup = shown?.kind === 'group' ? shown.group : null
  const lit = useMemo(() => (litGroup ? entriesTraining(program, litGroup, ctx) : []), [litGroup, program, ctx])
  const css = [`${SCOPE} ${DROP_CSS}`, litGroup ? litCss(SCOPE, lit) : ''].join('\n')

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
    change(`Added ${e.name} to ${dayName(day, 'long')}`, () => addEntries(day, [e.id], defaultSets(e), defaultReps(e, goal)))

  const primaries = (e: AnyExercise) =>
    Object.entries(resolveExercise(e.id, ctx)?.groups ?? {})
      .filter(([, g]) => g.role === 'primary')
      .map(([id]) => id)

  const board = (
    <div ref={boardRef} data-desk-board="" className="min-w-0">
      <style>{css}</style>
      <WeekBoard view={view} onAdd={onAdd} onHover={onEntryHover} />
    </div>
  )

  const panel = (
    <DeskMapPanel view={view} focus={shown} lit={lit} onFocusGroup={onFocusGroup} title={wide} />
  )

  const header = (
    <PageHeader
      title={title}
      actions={
        <>
          {!wide && (
            <IconButton
              icon={PersonStanding}
              label="Week map"
              aria-haspopup="dialog"
              aria-expanded={mapOpen}
              onClick={() => setMapOpen(true)}
            />
          )}
          {actions}
        </>
      }
    />
  )

  if (!wide) {
    return (
      <Page width="wide">
        {header}
        <PageBody>
          <InstallNudge className="mb-4" />
          {board}
        </PageBody>
        <Sheet open={mapOpen} onClose={() => setMapOpen(false)} title="This week" className="backdrop:bg-scrim/40">
          {panel}
        </Sheet>
        {children}
      </Page>
    )
  }

  return (
    <Page width="wide">
      <div style={{ '--page-max': '120rem' } as CSSProperties}>
        {header}
        <PageBody>
          <InstallNudge className="mb-4" />
          <DragDropProvider
            sensors={sensors}
            plugins={plugins}
            onDragStart={(event) => {
              const ex = (event.operation.source?.data as DrawerDragData | undefined)?.exercise
              setFocus(null)
              setDragGroups(ex ? primaries(ex) : null)
            }}
            onDragEnd={(event) => {
              setDragGroups(null)
              const ex = (event.operation.source?.data as DrawerDragData | undefined)?.exercise
              const day = (event.operation.target?.data as DayDropData | undefined)?.day
              if (!event.canceled && ex && day !== undefined) add(ex, day)
            }}
          >
            <div className="grid grid-cols-[auto_minmax(0,1fr)_19rem] items-start gap-4 min-[120rem]:grid-cols-[auto_minmax(0,1fr)_25rem]">
              {drawerOpen ? (
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
              )}
              {board}
              <aside
                aria-label="Week map"
                className={`${STICKY} max-h-[calc(100dvh-var(--safe-top)-5rem)] overflow-y-auto overscroll-contain`}
              >
                {panel}
              </aside>
            </div>
            {drawerOpen && <DayDrops days={order} board={boardRef} />}
            <DragOverlay dropAnimation={null}>
              {(source) => {
                const ex = (source.data as DrawerDragData | undefined)?.exercise
                return ex ? <DragCard exercise={ex} /> : null
              }}
            </DragOverlay>
          </DragDropProvider>
        </PageBody>
      </div>
      {children}
    </Page>
  )
}

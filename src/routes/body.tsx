import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { z } from 'zod'
import { NotMedicalAdvice } from '../app/brand'
import { DAY_SLUGS, dayFromSlug, dayName, daySlug } from '../app/days'
import { groupParam, headParam, optionalEnum, sheetParam } from '../app/search'
import { useWeek } from '../app/useWeek'
import { BodyMap, CoverageList, Insights, MuscleSheet, VolumeLegend } from '../features/bodymap'
import { useMessages } from '../i18n/messages'
import { SlidersHorizontal } from 'lucide-react'
import { ChipGroup, IconButton, Page, PageBody, PageHeader, Panel, SegmentedControl, Sheet, cx, useSheet } from '../ui'
import { bodyMessages } from './-messages'

// URL contract: /body?scope=week|mon..sun&shade=groups|heads&view=front|back|both
//               &sheet=muscle&group=chest(&head=pec_clavicular)
const BodySearch = z.object({
  scope: optionalEnum(['week', ...DAY_SLUGS]),
  shade: optionalEnum(['groups', 'heads']),
  view: optionalEnum(['front', 'back', 'both']),
  sheet: sheetParam(['muscle', 'view']),
  group: groupParam,
  head: headParam,
})

export const Route = createFileRoute('/body')({
  validateSearch: BodySearch,
  component: BodyPage,
})

function BodyPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const view = useWeek()
  const m = useMessages(bodyMessages)
  const muscle = useSheet('muscle', ['group', 'head'])
  const options = useSheet('view')
  const scope = search.scope ?? 'week'
  const shade = search.shade ?? 'groups'
  const mapView = search.view ?? 'both'
  const day = scope === 'week' ? null : dayFromSlug(scope)

  const week = view?.week
  const values = useMemo(() => {
    if (!week) return { groups: {}, heads: {} }
    if (day === null) return { groups: week.weekly, heads: week.shade.weekly }
    const col = (s: Record<string, number[]>) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v[day]]))
    return { groups: col(week.daily), heads: col(week.shade.daily) }
  }, [week, day])

  if (!view) return null
  const { coverage, order, prefs } = view

  const set = (patch: Partial<z.infer<typeof BodySearch>>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  const openGroup = (group: string) =>
    muscle.open ? muscle.update({ group, head: undefined }) : muscle.show({ group })
  const selected = muscle.open ? search.group : undefined
  const scale = day === null ? 'week' : 'day'
  const customized = mapView !== 'both' || shade !== 'groups'
  const toggles = {
    mapView,
    shade,
    onView: (v: 'both' | 'front' | 'back') => set({ view: v === 'both' ? undefined : v }),
    onShade: (v: 'groups' | 'heads') => set({ shade: v === 'groups' ? undefined : v }),
  }

  return (
    <Page>
      <div className="desktop:[--page-max:72rem]">
        <PageHeader
          title={m.title}
          settings
          actions={
            <IconButton
              icon={SlidersHorizontal}
              variant={customized ? 'tonal' : 'ghost'}
              label={m.mapOptions}
              aria-pressed={customized}
              className="desktop:hidden"
              onClick={() => options.show()}
            />
          }
        >
          <div className="space-y-3">
            <ChipGroup
              label={m.scope}
              scroll
              size="sm"
              options={[{ value: 'week', label: m.week }, ...order.map((d) => ({ value: daySlug(d), label: dayName(d) }))]}
              value={scope}
              onChange={(v) => set({ scope: v === 'week' ? undefined : (v ?? undefined) })}
            />
            <MapToggles className="hidden desktop:flex desktop:max-w-[34rem]" {...toggles} />
          </div>
        </PageHeader>

        <PageBody className="desktop:grid desktop:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] desktop:items-start desktop:gap-8">
          <Panel className="px-3 pb-4 pt-3 desktop:sticky desktop:top-[calc(var(--safe-top)+4.25rem)]">
            <BodyMap
              className="mx-auto max-w-[30rem] desktop:max-w-[min(30rem,calc((100dvh-16rem)*0.8))]"
              view={mapView}
              values={values}
              shade={shade}
              scale={scale}
              highlight={selected ? [selected] : undefined}
              onSelectGroup={openGroup}
              zoomable
              label={
                day === null ? m.mapWeek : m.mapDay(day)
              }
            />
            <VolumeLegend scale={scale} className="mx-auto mt-4 max-w-[30rem] px-1 desktop:max-w-[26rem]" />
          </Panel>

          <div className="mt-7 desktop:mt-0">
            <CoverageList
              week={view.week}
              coverage={coverage}
              goal={prefs.goal}
              day={day}
              selected={selected}
              onSelect={openGroup}
            />
            <Insights coverage={coverage} />
            <p className="mt-8 px-1 text-center text-xs text-ink-3"><NotMedicalAdvice /></p>
          </div>
        </PageBody>
      </div>

      <Sheet open={options.open} onClose={options.close} title={m.mapOptions} desktop="center">
        <MapToggles className="flex" {...toggles} />
        <p className="mt-3 text-sm text-ink-2">{m.mapOptionsHint}</p>
      </Sheet>
      <MuscleSheet
        open={muscle.open}
        onClose={muscle.close}
        group={search.group}
        head={search.head}
        onSelectHead={(head) => muscle.update({ head })}
        view={view}
        day={day}
      />
    </Page>
  )
}

function MapToggles({
  mapView,
  shade,
  onView,
  onShade,
  className,
}: {
  mapView: 'both' | 'front' | 'back'
  shade: 'groups' | 'heads'
  onView: (v: 'both' | 'front' | 'back') => void
  onShade: (v: 'groups' | 'heads') => void
  className?: string
}) {
  const m = useMessages(bodyMessages)
  return (
    <div className={cx('gap-2', className)}>
      <SegmentedControl
        label={m.views}
        size="sm"
        className="flex-[3]"
        options={[
          { value: 'both', label: m.both },
          { value: 'front', label: m.front },
          { value: 'back', label: m.back },
        ]}
        value={mapView}
        onChange={onView}
      />
      <SegmentedControl
        label={m.shading}
        size="sm"
        className="flex-[2]"
        options={[
          { value: 'groups', label: m.groups },
          { value: 'heads', label: m.heads },
        ]}
        value={shade}
        onChange={onShade}
      />
    </div>
  )
}

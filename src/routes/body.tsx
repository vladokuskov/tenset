import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { z } from 'zod'
import { NOT_MEDICAL_ADVICE } from '../app/brand'
import { DAY_SLUGS, dayFromSlug, dayName, daySlug } from '../app/days'
import { groupParam, headParam, optionalEnum, sheetParam } from '../app/search'
import { useWeek } from '../app/useWeek'
import { BodyMap, CoverageList, Insights, MuscleSheet, VolumeLegend } from '../features/bodymap'
import { ChipGroup, Page, PageBody, PageHeader, Panel, SegmentedControl, useSheet } from '../ui'

// URL contract: /body?scope=week|mon..sun&shade=groups|heads&view=front|back|both
//               &sheet=muscle&group=chest(&head=pec_clavicular)
const BodySearch = z.object({
  scope: optionalEnum(['week', ...DAY_SLUGS]),
  shade: optionalEnum(['groups', 'heads']),
  view: optionalEnum(['front', 'back', 'both']),
  sheet: sheetParam(['muscle']),
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
  const muscle = useSheet('muscle', ['group', 'head'])
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

  return (
    <Page>
      <div className="desktop:[--page-max:72rem]">
        <PageHeader title="Body">
          <div className="space-y-3">
            <ChipGroup
              label="Scope"
              scroll
              size="sm"
              options={[{ value: 'week', label: 'Week' }, ...order.map((d) => ({ value: daySlug(d), label: dayName(d) }))]}
              value={scope}
              onChange={(v) => set({ scope: v === 'week' ? undefined : (v ?? undefined) })}
            />
            <div className="flex gap-2 desktop:max-w-[34rem]">
              <SegmentedControl
                label="Views"
                size="sm"
                className="flex-[3]"
                options={[
                  { value: 'both', label: 'Both' },
                  { value: 'front', label: 'Front' },
                  { value: 'back', label: 'Back' },
                ]}
                value={mapView}
                onChange={(v) => set({ view: v === 'both' ? undefined : v })}
              />
              <SegmentedControl
                label="Shading"
                size="sm"
                className="flex-[2]"
                options={[
                  { value: 'groups', label: 'Groups' },
                  { value: 'heads', label: 'Heads' },
                ]}
                value={shade}
                onChange={(v) => set({ shade: v === 'groups' ? undefined : v })}
              />
            </div>
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
                day === null
                  ? 'Weekly volume by muscle. The coverage list below has the same information.'
                  : `Volume on ${dayName(day, 'long')} by muscle. The coverage list below has the same information.`
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
            <p className="mt-8 px-1 text-center text-xs text-ink-3">{NOT_MEDICAL_ADVICE}</p>
          </div>
        </PageBody>
      </div>

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

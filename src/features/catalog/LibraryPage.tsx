import { Link, getRouteApi } from '@tanstack/react-router'
import { ChevronDown, Search, SearchX, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useCatalog } from '../../app/useCatalog'
import { groupName } from '../../data/localize'
import type { MovementGroupId } from '../../domain/movement'
import { common } from '../../i18n/common'
import { useLocale } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { Button, Chip, EmptyState, LanguagePicker, Page, PageBody, PageHeader, SegmentedControl, Sheet, useSheet } from '../../ui'
import { EquipmentPicker } from './EquipmentPicker'
import { equipmentSummary } from './equipmentSummary'
import { ExerciseGrid } from './ExerciseGrid'
import { ExercisePreview } from './ExercisePreview'
import { catalogMessages } from './messages'
import { MovementChips } from './MovementChips'
import { MuscleFilterSheet } from './MuscleFilterSheet'
import { buildIndex, filterExercises } from './search'

const route = getRouteApi('/')

type Patch = Partial<{ q: string; muscle: string; equip: 'mine' | 'all'; move: MovementGroupId; sheet: 'muscle' | 'equipment' | 'exercise' }>

export function LibraryPage() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const { activeExercises, exerciseBySlug } = useCatalog()
  const equipment = usePrefsStore((s) => s.equipment)
  const setEquipment = usePrefsStore((s) => s.setEquipment)
  const muscleSheet = useSheet('muscle')
  const equipmentSheet = useSheet('equipment')
  const exerciseSheet = useSheet('exercise', ['ex'])
  const locale = useLocale()
  const m = catalogMessages[locale]
  const index = useMemo(() => buildIndex(activeExercises, locale), [activeExercises, locale])

  const mine = (search.equip ?? 'mine') === 'mine'
  const [text, setText] = useState(search.q ?? '')
  const [syncedQ, setSyncedQ] = useState(search.q)
  if (search.q !== syncedQ) {
    setSyncedQ(search.q)
    if ((search.q ?? '') !== text.trim()) setText(search.q ?? '')
  }

  const set = (patch: Patch) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  const clear = (patch: Patch = {}) => {
    setText('')
    set({ q: undefined, muscle: undefined, move: undefined, ...patch })
  }

  const available = mine ? equipment : undefined
  const list = useMemo(
    () => filterExercises(activeExercises, index, { q: search.q, move: search.move, available, muscle: search.muscle }),
    [activeExercises, index, search.q, search.move, available, search.muscle],
  )
  const anyEquipment = useMemo(
    () => (mine ? filterExercises(activeExercises, index, { q: search.q, move: search.move, muscle: search.muscle }).length : list.length),
    [mine, activeExercises, index, search.q, search.move, search.muscle, list.length],
  )
  const muscleCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of filterExercises(activeExercises, index, { q: search.q, move: search.move, available })) {
      for (const [g, r] of Object.entries(e.groups)) if (r === 'primary') counts[g] = (counts[g] ?? 0) + 1
    }
    return counts
  }, [activeExercises, index, search.q, search.move, available])

  const muscleName = search.muscle ? groupName(search.muscle, locale) : undefined
  const narrowed = Boolean(search.q || search.muscle || search.move)

  return (
    <Page>
      <PageHeader
        title={m.exercises}
        subtitle={common[locale].exercises(list.length)}
        actions={
          <LanguagePicker />
        }
      >
        <div className="space-y-3">
          <label className="flex h-11 items-center gap-2 rounded-md bg-surface-2 px-3 text-ink-2 focus-within:outline-2 focus-within:outline-accent">
            <Search size={18} strokeWidth={1.75} aria-hidden />
            <input
              type="search"
              aria-label={m.searchExercises}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                const q = e.target.value.trim() || undefined
                setSyncedQ(q)
                set({ q })
              }}
              placeholder={m.searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {text && (
              <button
                type="button"
                aria-label={m.clearSearch}
                className="hit -mr-1 flex size-7 items-center justify-center rounded-full text-ink-3 hover:text-ink"
                onClick={() => {
                  setText('')
                  setSyncedQ(undefined)
                  set({ q: undefined })
                }}
              >
                <X size={16} strokeWidth={2} aria-hidden />
              </button>
            )}
          </label>
          <div role="group" aria-label={m.filters} className="scrollbar-none -mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1">
            <Chip size="sm" selected={mine} aria-haspopup="dialog" onClick={() => equipmentSheet.show()}>
              {mine ? equipmentSummary(equipment, locale) : m.anyEquipment}
              <ChevronDown size={14} strokeWidth={2} aria-hidden className={mine ? 'text-on-ink/70' : 'text-ink-3'} />
            </Chip>
            <Chip size="sm" selected={Boolean(search.muscle)} aria-haspopup="dialog" onClick={() => muscleSheet.show()}>
              {muscleName ?? m.muscle}
              <ChevronDown size={14} strokeWidth={2} aria-hidden className={search.muscle ? 'text-on-ink/70' : 'text-ink-3'} />
            </Chip>
            {narrowed && (
              <Button variant="link" size="sm" className="ml-1 shrink-0" onClick={() => clear()}>
                {m.clear}
              </Button>
            )}
          </div>
          <MovementChips label={m.movementGroups} value={search.move} onChange={(move) => set({ move })} />
        </div>
      </PageHeader>

      <PageBody>
        {list.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={m.noMatch}
            actions={
              <>
                {mine && anyEquipment > 0 && (
                  <Button variant="secondary" onClick={() => set({ equip: 'all' })}>
                    {m.showForAny(anyEquipment)}
                  </Button>
                )}
                <Button variant="primary" onClick={() => clear({ equip: 'all' })}>
                  {m.clearAll}
                </Button>
              </>
            }
          />
        ) : (
          <>
            <ExerciseGrid exercises={list} label={m.exercises} onOpen={(e) => exerciseSheet.show({ ex: e.slug })} />
            {(muscleName || (mine && anyEquipment > list.length)) && (
              <div className="mt-2 space-y-1 px-1 text-sm text-ink-2">
                {muscleName && <p>{m.primaryNote(muscleName)}</p>}
                {mine && anyEquipment > list.length && (
                  <p>
                    {m.moreNeedOther(anyEquipment - list.length)}{' '}
                    <Button variant="link" size="sm" onClick={() => set({ equip: 'all' })}>
                      {m.showAll}
                    </Button>
                  </p>
                )}
              </div>
            )}
          </>
        )}
        <footer className="mt-10 flex flex-wrap gap-x-4 gap-y-1 px-1 text-sm text-ink-3">
          <Link to="/credits" className="underline-offset-2 hover:underline">
            {m.credits}
          </Link>
          <Link to="/privacy" className="underline-offset-2 hover:underline">
            {m.privacy}
          </Link>
        </footer>
      </PageBody>

      <MuscleFilterSheet
        open={muscleSheet.open}
        onClose={muscleSheet.close}
        value={search.muscle}
        counts={muscleCounts}
        onSelect={(g) => void navigate({ search: (prev) => ({ ...prev, muscle: g, sheet: undefined }), replace: true })}
      />
      <ExercisePreview
        exercise={search.ex ? exerciseBySlug.get(search.ex) : undefined}
        open={exerciseSheet.open}
        onClose={exerciseSheet.close}
      />
      <Sheet open={equipmentSheet.open} onClose={equipmentSheet.close} title={m.equipmentTitle} description={m.equipmentHint}>
        <SegmentedControl
          label={m.equipmentTitle}
          options={[
            { value: 'mine', label: m.myEquipment },
            { value: 'all', label: m.anyEquipment },
          ]}
          value={mine ? 'mine' : 'all'}
          onChange={(equip) => set({ equip })}
          block
          equal
          className="mb-5"
        />
        <EquipmentPicker
          value={equipment}
          onChange={(next) => {
            setEquipment(next)
            if (!mine) set({ equip: undefined })
          }}
        />
      </Sheet>
    </Page>
  )
}

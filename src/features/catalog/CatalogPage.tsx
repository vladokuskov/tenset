import { getRouteApi } from '@tanstack/react-router'
import { ChevronDown, Search, SearchX, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { countLabel } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import type { Pattern } from '../../domain/schema'
import { getGroup } from '../../domain/taxonomy'
import { usePrefsStore } from '../../store/prefs.store'
import { Button, Chip, EmptyState, Page, PageBody, PageHeader, useSheet } from '../../ui'
import { ExerciseGrid } from './ExerciseGrid'
import { FilterSelect } from './FilterSelect'
import { MuscleFilterSheet } from './MuscleFilterSheet'
import { LEVEL_LABEL, PATTERN_GROUPS, PATTERN_LABEL } from './patterns'
import { applyOverride } from './roles'
import { buildIndex, filterExercises } from './search'

const route = getRouteApi('/exercises')

type Patch = Partial<{
  q: string
  muscle: string
  equip: 'mine' | 'all'
  pattern: Pattern
  level: number
  sheet: 'muscle'
}>

type ActiveFilter = { key: keyof Patch; label: string; clear: Patch }

const LEVELS = [{ label: '', options: [1, 2, 3].map((l) => ({ value: String(l), label: LEVEL_LABEL[l] })) }]

export function CatalogPage() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const { activeExercises } = useCatalog()
  const equipment = usePrefsStore((s) => s.equipment)
  const overrides = usePrefsStore((s) => s.overrides)
  const muscleSheet = useSheet('muscle')
  const index = useMemo(() => buildIndex(activeExercises), [activeExercises])

  const equip = search.equip ?? 'mine'
  const [text, setText] = useState(search.q ?? '')
  const [syncedQ, setSyncedQ] = useState(search.q)
  if (search.q !== syncedQ) {
    setSyncedQ(search.q)
    if ((search.q ?? '') !== text.trim()) setText(search.q ?? '')
  }

  const set = (patch: Patch) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const base = useMemo(
    () => ({ q: search.q, pattern: search.pattern, level: search.level }),
    [search.q, search.pattern, search.level],
  )
  const available = equip === 'mine' ? equipment : undefined
  const list = useMemo(
    () => filterExercises(activeExercises, index, { ...base, available, muscle: search.muscle }, overrides),
    [activeExercises, index, base, available, search.muscle, overrides],
  )
  const anyEquipment = useMemo(
    () => (equip === 'mine' ? filterExercises(activeExercises, index, { ...base, muscle: search.muscle }, overrides).length : list.length),
    [equip, activeExercises, index, base, search.muscle, overrides, list.length],
  )
  const muscleCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of filterExercises(activeExercises, index, { ...base, available }, overrides)) {
      for (const [g, r] of Object.entries(applyOverride(e.groups, overrides[String(e.id)]))) {
        if (r === 'primary') counts[g] = (counts[g] ?? 0) + 1
      }
    }
    return counts
  }, [activeExercises, index, base, available, overrides])

  const patternGroups = useMemo(() => {
    const present = new Set(activeExercises.map((e) => e.pattern))
    return PATTERN_GROUPS.map((g) => ({
      label: g.label,
      options: g.patterns.filter((p) => present.has(p)).map((p) => ({ value: p, label: PATTERN_LABEL[p] })),
    })).filter((g) => g.options.length)
  }, [activeExercises])

  const muscleName = search.muscle ? (getGroup(search.muscle)?.name ?? search.muscle) : undefined
  const narrowed = Boolean(search.q || search.muscle || search.pattern || search.level)
  const active: ActiveFilter[] = []
  if (search.q) active.push({ key: 'q', label: `"${search.q}"`, clear: { q: undefined } })
  if (muscleName) active.push({ key: 'muscle', label: muscleName, clear: { muscle: undefined } })
  if (equip === 'mine') active.push({ key: 'equip', label: 'My equipment', clear: { equip: 'all' } })
  if (search.pattern) active.push({ key: 'pattern', label: PATTERN_LABEL[search.pattern], clear: { pattern: undefined } })
  if (search.level) active.push({ key: 'level', label: LEVEL_LABEL[search.level], clear: { level: undefined } })

  return (
    <Page>
      <PageHeader title="Exercises" subtitle={countLabel(list.length, 'exercise')}>
        <div className="space-y-3">
          <label className="flex h-11 items-center gap-2 rounded-md bg-surface-2 px-3 text-ink-2 focus-within:outline-2 focus-within:outline-accent">
            <Search size={18} strokeWidth={1.75} aria-hidden />
            <span className="sr-only">Search exercises</span>
            <input
              type="search"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                const q = e.target.value.trim() || undefined
                setSyncedQ(q)
                set({ q })
              }}
              placeholder="Search, e.g. RDL or OHP"
              className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {text && (
              <button
                type="button"
                aria-label="Clear search"
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
          <div role="group" aria-label="Filters" className="scrollbar-none -mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1">
            <Chip
              size="sm"
              selected={Boolean(search.muscle)}
              aria-haspopup="dialog"
              onClick={() => muscleSheet.show()}
            >
              {muscleName ?? 'Muscle'}
              <ChevronDown size={14} strokeWidth={2} aria-hidden className={search.muscle ? 'text-on-ink/70' : 'text-ink-3'} />
            </Chip>
            <Chip size="sm" selected={equip === 'mine'} onClick={() => set({ equip: equip === 'mine' ? 'all' : undefined })}>
              My equipment
            </Chip>
            <FilterSelect
              label="Movement pattern"
              placeholder="Pattern"
              value={search.pattern}
              groups={patternGroups}
              onChange={(v) => set({ pattern: v as Pattern | undefined })}
            />
            <FilterSelect
              label="Level"
              placeholder="Level"
              value={search.level ? String(search.level) : undefined}
              groups={LEVELS}
              onChange={(v) => set({ level: v ? Number(v) : undefined })}
            />
            {narrowed && (
              <Button
                variant="link"
                size="sm"
                className="ml-1 shrink-0"
                onClick={() => {
                  setText('')
                  set({ q: undefined, muscle: undefined, pattern: undefined, level: undefined })
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </PageHeader>

      <PageBody>
        {list.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No exercises match"
            actions={
              <>
                {equip === 'mine' && anyEquipment > 0 && (
                  <Button variant="secondary" onClick={() => set({ equip: 'all' })}>
                    Show {countLabel(anyEquipment, 'match', 'matches')} for any equipment
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={() => {
                    setText('')
                    set({ q: undefined, muscle: undefined, pattern: undefined, level: undefined, equip: 'all' })
                  }}
                >
                  Clear all filters
                </Button>
              </>
            }
          >
            <p>Active filters. Tap one to remove it.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {active.map((f) => (
                <Chip
                  key={f.key}
                  size="sm"
                  aria-label={`Remove filter ${f.label}`}
                  onRemove={() => {
                    if (f.key === 'q') setText('')
                    set(f.clear)
                  }}
                >
                  {f.label}
                </Chip>
              ))}
            </div>
          </EmptyState>
        ) : (
          <>
            <ExerciseGrid exercises={list} label="Exercises" />
            {(search.muscle || (equip === 'mine' && anyEquipment > list.length)) && (
              <div className="mt-2 space-y-1 px-1 text-sm text-ink-2">
                {muscleName && <p>Exercises where {muscleName.toLowerCase()} is a primary muscle.</p>}
                {equip === 'mine' && anyEquipment > list.length && (
                  <p>
                    {countLabel(anyEquipment - list.length, 'more exercise')} {anyEquipment - list.length === 1 ? 'needs' : 'need'} other
                    equipment.{' '}
                    <Button variant="link" size="sm" onClick={() => set({ equip: 'all' })}>
                      Show all
                    </Button>
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </PageBody>

      <MuscleFilterSheet
        open={muscleSheet.open}
        onClose={muscleSheet.close}
        value={search.muscle}
        counts={muscleCounts}
        onSelect={(g) => void navigate({ search: (prev) => ({ ...prev, muscle: g, sheet: undefined }), replace: true })}
      />
    </Page>
  )
}

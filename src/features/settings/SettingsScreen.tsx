import { getRouteApi } from '@tanstack/react-router'
import { ChevronRight, Plus } from 'lucide-react'
import { dayName } from '../../app/days'
import { countLabel, joinMeta } from '../../app/format'
import { MAX_CUSTOM } from '../../domain/program'
import { usePrefsStore } from '../../store/prefs.store'
import { useActiveProgram } from '../../store/program.store'
import { Button, Page, PageBody, PageHeader, Section, SegmentedControl, Sheet, useSheet } from '../../ui'
import { groupName } from '../builder/labels'
import { CustomExerciseSheet } from './CustomExerciseSheet'
import { EquipmentPicker } from './EquipmentPicker'
import { equipmentSummary } from './equipmentSummary'
import { OverridesSheet } from './OverridesSheet'

const route = getRouteApi('/settings')

const GOAL_HINT = {
  hypertrophy: 'Bands follow the weekly set ranges used in muscle growth research.',
  strength: 'Also shows main lifts trained on fewer than 2 days a week.',
  general: '4 to 10 weekly sets reads as good for general fitness.',
} as const

const COUNTING_HINT = {
  fractional: 'Primary muscles count each set as 1, secondary muscles as 0.5.',
  primary: 'Only primary muscles count. Secondary muscles show 0.',
} as const

const rowButton = 'flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left'

export function SettingsScreen() {
  const s = usePrefsStore((st) => st)
  const program = useActiveProgram()
  const search = route.useSearch()
  const equipmentSheet = useSheet('equipment')
  const overridesSheet = useSheet('overrides')
  const customSheet = useSheet('custom', ['id'])
  const overrideCount = Object.keys(s.overrides).length
  const custom = program?.custom ?? []

  return (
    <Page>
      <PageHeader title="Settings" back={{ to: '/', label: 'Plan' }} />
      <PageBody>
        <Section title="Goal" description={GOAL_HINT[s.goal]}>
          <SegmentedControl
            label="Goal"
            block
            options={[
              { value: 'hypertrophy', label: 'Muscle' },
              { value: 'strength', label: 'Strength' },
              { value: 'general', label: 'General' },
            ]}
            value={s.goal}
            onChange={s.setGoal}
          />
        </Section>

        <Section title="Equipment">
          <div className="flex min-h-14 items-center gap-3 rounded-xl bg-surface px-4 py-2">
            <span className="num min-w-0 flex-1 text-base">{equipmentSummary(s.equipment)}</span>
            <Button variant="secondary" size="sm" onClick={() => equipmentSheet.show()}>
              Edit
            </Button>
          </div>
        </Section>

        <Section title="Counting" description={COUNTING_HINT[s.countingMode]}>
          <SegmentedControl
            label="Counting mode"
            block
            options={[
              { value: 'fractional', label: 'Fractional (0.5)' },
              { value: 'primary', label: 'Primary only' },
            ]}
            value={s.countingMode}
            onChange={s.setCountingMode}
          />
        </Section>

        <Section title="Week starts on">
          <SegmentedControl
            label="Week starts on"
            block
            options={[...new Set([0, 5, 6, s.weekStart])].map((d) => ({ value: String(d), label: dayName(d, 'long') }))}
            value={String(s.weekStart)}
            onChange={(v) => s.setWeekStart(Number(v))}
          />
        </Section>

        <Section
          title="Custom exercises"
          description={program ? `Saved with ${program.name}. Share links include them.` : 'Create a program first.'}
        >
          <div className="rounded-xl bg-surface">
            {custom.length > 0 && (
              <ul className="divide-y divide-line">
                {custom.map((c) => (
                  <li key={c.id}>
                    <button type="button" className={rowButton} onClick={() => customSheet.show({ id: c.id })}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-medium">{c.name}</span>
                        <span className="block truncate text-sm text-ink-2">
                          {joinMeta([
                            Object.entries(c.groups)
                              .filter(([, r]) => r === 'primary')
                              .map(([g]) => groupName(g))
                              .join(', '),
                            c.equipment.length ? countLabel(c.equipment.length, 'item') : 'Bodyweight',
                          ])}
                        </span>
                      </span>
                      <ChevronRight size={18} className="shrink-0 text-ink-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className={custom.length ? 'border-t border-line px-4 py-3' : 'px-4 py-3'}>
              <Button
                icon={Plus}
                size="sm"
                disabled={!program || custom.length >= MAX_CUSTOM}
                onClick={() => customSheet.show({ id: 'new' })}
              >
                Add custom exercise
              </Button>
              <p className="num mt-2 text-xs text-ink-3">
                {custom.length} of {MAX_CUSTOM} used
              </p>
            </div>
          </div>
        </Section>

        <Section title="Custom mappings" description='Changes made with "Edit how this counts" on an exercise.'>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
            <span className="text-ink-2">{overrideCount ? `${countLabel(overrideCount, 'exercise')} changed` : 'No exercises changed'}</span>
            <Button variant="secondary" size="sm" onClick={() => overridesSheet.show()} disabled={!overrideCount}>
              Review
            </Button>
          </div>
        </Section>
      </PageBody>

      <Sheet open={equipmentSheet.open} onClose={equipmentSheet.close} title="Equipment" description="Exercises that need something unchecked are left out of suggestions.">
        <EquipmentPicker value={s.equipment} onChange={s.setEquipment} />
      </Sheet>
      <OverridesSheet open={overridesSheet.open} onClose={overridesSheet.close} />
      <CustomExerciseSheet id={search.id} open={customSheet.open} onClose={customSheet.close} />
    </Page>
  )
}

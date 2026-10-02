import { getRouteApi } from '@tanstack/react-router'
import { ChevronRight, Plus } from 'lucide-react'
import { dayName } from '../../app/days'
import { joinMeta } from '../../app/format'
import { MAX_CUSTOM } from '../../domain/program'
import { useLocale, useMessages } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { useActiveProgram } from '../../store/program.store'
import { Button, LanguageToggle, Page, PageBody, PageHeader, Section, SegmentedControl, Sheet, useSheet } from '../../ui'
import { LANGUAGE_LABEL } from '../../ui/LanguageToggle'
import { groupName } from '../builder/labels'
import { CustomExerciseSheet } from './CustomExerciseSheet'
import { EquipmentPicker } from './EquipmentPicker'
import { equipmentSummary } from './equipmentSummary'
import { settingsMessages } from './messages'
import { OverridesSheet } from './OverridesSheet'

const route = getRouteApi('/settings')

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
  const m = useMessages(settingsMessages)
  const locale = useLocale()

  return (
    <Page>
      <PageHeader title={m.title} back={{ to: '/', label: m.plan }} />
      <PageBody>
        <Section title={LANGUAGE_LABEL}>
          <LanguageToggle size="md" block />
        </Section>

        <Section title={m.goal} description={m.goalHint[s.goal]}>
          <SegmentedControl
            label={m.goal}
            block
            options={[
              { value: 'hypertrophy', label: m.goalOption.hypertrophy },
              { value: 'strength', label: m.goalOption.strength },
              { value: 'general', label: m.goalOption.general },
            ]}
            value={s.goal}
            onChange={s.setGoal}
          />
        </Section>

        <Section title={m.equipment}>
          <div className="flex min-h-14 items-center gap-3 rounded-xl bg-surface px-4 py-2">
            <span className="num min-w-0 flex-1 text-base">{equipmentSummary(s.equipment, locale)}</span>
            <Button variant="secondary" size="sm" onClick={() => equipmentSheet.show()}>
              {m.edit}
            </Button>
          </div>
        </Section>

        <Section title={m.counting} description={m.countingHint[s.countingMode]}>
          <SegmentedControl
            label={m.countingMode}
            block
            options={[
              { value: 'fractional', label: m.fractional },
              { value: 'primary', label: m.primaryOnly },
            ]}
            value={s.countingMode}
            onChange={s.setCountingMode}
          />
        </Section>

        <Section title={m.weekStartsOn}>
          <SegmentedControl
            label={m.weekStartsOn}
            block
            options={[...new Set([0, 5, 6, s.weekStart])].map((d) => ({ value: String(d), label: dayName(d, 'long', locale) }))}
            value={String(s.weekStart)}
            onChange={(v) => s.setWeekStart(Number(v))}
          />
        </Section>

        <Section
          title={m.customExercises}
          description={program ? m.savedWith(program.name) : m.createProgramFirst}
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
                              .map(([g]) => groupName(g, locale))
                              .join(', '),
                            c.equipment.length ? m.items(c.equipment.length) : m.bodyweight,
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
                {m.addCustom}
              </Button>
              <p className="num mt-2 text-xs text-ink-3">
                {m.used(custom.length, MAX_CUSTOM)}
              </p>
            </div>
          </div>
        </Section>

        <Section title={m.customMappings} description={m.customMappingsHint}>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
            <span className="text-ink-2">{overrideCount ? m.exercisesChanged(overrideCount) : m.noExercisesChanged}</span>
            <Button variant="secondary" size="sm" onClick={() => overridesSheet.show()} disabled={!overrideCount}>
              {m.review}
            </Button>
          </div>
        </Section>
      </PageBody>

      <Sheet open={equipmentSheet.open} onClose={equipmentSheet.close} title={m.equipment} description={m.equipmentSheetHint}>
        <EquipmentPicker value={s.equipment} onChange={s.setEquipment} />
      </Sheet>
      <OverridesSheet open={overridesSheet.open} onClose={overridesSheet.close} />
      <CustomExerciseSheet id={search.id} open={customSheet.open} onClose={customSheet.close} />
    </Page>
  )
}

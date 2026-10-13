import { getRouteApi } from '@tanstack/react-router'
import { ChevronRight, Plus } from 'lucide-react'
import { dayName } from '../../app/days'
import { joinMeta } from '../../app/format'
import { groupName } from '../../data/localize'
import { MAX_CUSTOM } from '../../domain/program'
import { useLocale, useMessages } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { useActiveProgram } from '../../store/program.store'
import { Button, LanguageToggle, Page, PageBody, PageHeader, Panel, Section, SegmentedControl, Sheet, useSheet } from '../../ui'
import { LANGUAGE_LABEL } from '../../ui/LanguageToggle'
import { CustomExerciseSheet } from './CustomExerciseSheet'
import { DataSection } from './DataSection'
import { EquipmentPicker } from './EquipmentPicker'
import { equipmentSummary } from './equipmentSummary'
import { settingsMessages } from './messages'
import { OverridesSheet } from './OverridesSheet'
import { SettingRow, SettingValue } from './SettingRow'
import { targetsSummary } from './targetRanges'
import { TargetsSheet } from './TargetsSheet'

const route = getRouteApi('/settings')

const rowButton = 'flex min-h-14 w-full items-center gap-3 py-2 text-left'

export function SettingsScreen() {
  const s = usePrefsStore((st) => st)
  const program = useActiveProgram()
  const search = route.useSearch()
  const equipmentSheet = useSheet('equipment')
  const overridesSheet = useSheet('overrides')
  const customSheet = useSheet('custom', ['id'])
  const targetsSheet = useSheet('targets', ['group'])
  const overrideCount = Object.keys(s.overrides).length
  const custom = program?.custom ?? []
  const m = useMessages(settingsMessages)
  const locale = useLocale()

  return (
    <Page className="md:[--page-max:54rem]">
      <PageHeader title={m.title} back={{ to: '/', label: m.plan, className: 'desktop:hidden' }} />
      <PageBody>
        <Section title={m.group.general}>
          <Panel className="divide-y divide-line">
            <SettingRow label={LANGUAGE_LABEL}>
              <LanguageToggle block />
            </SettingRow>
            <SettingRow label={m.weekStartsOn}>
              <SegmentedControl
                label={m.weekStartsOn}
                block
                equal
                options={[...new Set([0, 5, 6, s.weekStart])].map((d) => ({ value: String(d), label: dayName(d, 'long', locale) }))}
                value={String(s.weekStart)}
                onChange={(v) => s.setWeekStart(Number(v))}
              />
            </SettingRow>
          </Panel>
        </Section>

        <Section title={m.group.training}>
          <Panel className="divide-y divide-line">
            <SettingRow label={m.goal} hint={m.goalHint[s.goal]}>
              <SegmentedControl
                label={m.goal}
                block
                equal
                options={[
                  { value: 'hypertrophy', label: m.goalOption.hypertrophy },
                  { value: 'strength', label: m.goalOption.strength },
                  { value: 'general', label: m.goalOption.general },
                ]}
                value={s.goal}
                onChange={s.setGoal}
              />
            </SettingRow>
            <SettingRow label={m.muscleRanges} hint={m.muscleRangesHint}>
              <SettingValue
                action={
                  <Button variant="secondary" size="sm" onClick={() => targetsSheet.show()}>
                    {m.adjust}
                  </Button>
                }
              >
                {targetsSummary(s.targets, locale)}
              </SettingValue>
            </SettingRow>
            <SettingRow label={m.counting} hint={m.countingHint[s.countingMode]}>
              <SegmentedControl
                label={m.countingMode}
                block
                equal
                options={[
                  { value: 'fractional', label: m.fractional },
                  { value: 'primary', label: m.primaryOnly },
                ]}
                value={s.countingMode}
                onChange={s.setCountingMode}
              />
            </SettingRow>
          </Panel>
        </Section>

        <Section title={m.group.exercises}>
          <Panel className="divide-y divide-line">
            <SettingRow label={m.equipment} hint={m.equipmentSheetHint}>
              <SettingValue
                action={
                  <Button variant="secondary" size="sm" onClick={() => equipmentSheet.show()}>
                    {m.edit}
                  </Button>
                }
              >
                {equipmentSummary(s.equipment, locale)}
              </SettingValue>
            </SettingRow>
            <SettingRow label={m.customMappings} hint={m.customMappingsHint}>
              <SettingValue
                action={
                  <Button variant="secondary" size="sm" onClick={() => overridesSheet.show()} disabled={!overrideCount}>
                    {m.review}
                  </Button>
                }
              >
                {overrideCount ? m.exercisesChanged(overrideCount) : m.noExercisesChanged}
              </SettingValue>
            </SettingRow>
            <div>
              <SettingRow
                label={m.customExercises}
                hint={
                  <>
                    <p>{program ? m.savedWith(program.name) : m.createProgramFirst}</p>
                    <p className="num mt-1 text-xs text-ink-3">{m.used(custom.length, MAX_CUSTOM)}</p>
                  </>
                }
              >
                <Button
                  icon={Plus}
                  size="sm"
                  disabled={!program || custom.length >= MAX_CUSTOM}
                  onClick={() => customSheet.show({ id: 'new' })}
                  className="md:ml-auto"
                >
                  {m.addCustom}
                </Button>
              </SettingRow>
              {custom.length > 0 && (
                <ul className="mx-4 mb-2 divide-y divide-line border-t border-line">
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
            </div>
          </Panel>
        </Section>

        <DataSection />
      </PageBody>

      <Sheet open={equipmentSheet.open} onClose={equipmentSheet.close} title={m.equipment} description={m.equipmentSheetHint}>
        <EquipmentPicker value={s.equipment} onChange={s.setEquipment} />
      </Sheet>
      <OverridesSheet open={overridesSheet.open} onClose={overridesSheet.close} />
      <TargetsSheet open={targetsSheet.open} onClose={targetsSheet.close} focus={search.group} />
      <CustomExerciseSheet id={search.id} open={customSheet.open} onClose={customSheet.close} />
    </Page>
  )
}

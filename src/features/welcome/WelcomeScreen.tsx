import { getRouteApi, useNavigate, useRouter } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { APP_NAME, NOT_MEDICAL_ADVICE } from '../../app/brand'
import { BrandMark } from '../../app/BrandMark'
import { sortDays, type DayIndex } from '../../app/days'
import { countLabel, joinMeta, plural } from '../../app/format'
import { gapNote } from '../../app/knownGaps'
import { useCatalog } from '../../app/useCatalog'
import { computeCoverage } from '../../domain/coverage'
import { equipment as allEquipment, matchPreset, presetEquipment, presets } from '../../domain/equipment'
import { sequentialIds } from '../../domain/ids'
import { applyTemplate } from '../../domain/program'
import type { SplitTemplate } from '../../domain/schema'
import { computeWeek } from '../../domain/volume'
import { usePrefsStore } from '../../store/prefs.store'
import { useProgramStore } from '../../store/program.store'
import { DayPicker } from '../builder'
import { LEVEL_LABEL } from '../catalog'
import { EquipmentChecklist } from '../settings/EquipmentChecklist'
import { Button, Page, PageBody, StickyActions, cx, showToast } from '../../ui'
import { TemplateCard } from './TemplateCard'

const route = getRouteApi('/welcome')
const STEPS = 3
const BLANK = 'blank'

/** Hints under the day toggles: which session lands on each training day. */
function sessionHints(template: SplitTemplate | undefined, days: readonly DayIndex[]): Partial<Record<DayIndex, string>> {
  if (!template?.sessions.length) return {}
  const labels = template.sessions.map((s) => s.label)
  const words = labels.map((l) => l.split(' '))
  const shared = words.every((w) => w.length > 1 && w[0] === words[0][0]) ? 1 : 0
  const short = labels.map((l, i) => (shared ? words[i].slice(shared).join(' ') : l))
  const out: Partial<Record<DayIndex, string>> = {}
  sortDays(days, 0).forEach((d, i) => {
    out[d] = short[i % short.length]
  })
  return out
}

export function WelcomeScreen() {
  const step = route.useSearch({ select: (s) => s.step ?? 1 })
  const navigate = useNavigate()
  const router = useRouter()
  const { splits, splitById, catalog } = useCatalog()
  const prefs = usePrefsStore((s) => s)
  const createBlank = useProgramStore((s) => s.createBlank)
  const createFromTemplate = useProgramStore((s) => s.createFromTemplate)
  const [choice, setChoice] = useState<string>(() => splits[0]?.id ?? BLANK)
  const [days, setDays] = useState<DayIndex[] | null>(null)
  const [equip, setEquip] = useState<string[]>(() => [...prefs.equipment])
  const [custom, setCustom] = useState(false)

  const template = choice === BLANK ? undefined : splitById.get(choice)
  const trainingDays = days ?? template?.defaultDays ?? [0, 2, 4]
  const preset = custom ? null : matchPreset(equip)
  const gaps = gapNote(equip)

  const previews = useMemo(() => {
    const out = new Map<string, { weekly: Record<string, number>; trained: number; total: number; sets: number }>()
    for (const s of splits) {
      const { program } = applyTemplate(s, s.defaultDays, equip, catalog, { id: 'preview', makeId: sequentialIds('p') })
      const week = computeWeek(program, { catalog, prefs: { countingMode: prefs.countingMode, overrides: prefs.overrides } })
      const coverage = computeCoverage(week, prefs.goal)
      const sets = program.days.reduce((n, d) => n + d.entries.reduce((a, e) => a + e.sets, 0), 0)
      out.set(s.id, { weekly: week.weekly, trained: coverage.trainedBanded, total: coverage.totalBanded, sets })
    }
    return out
  }, [splits, equip, catalog, prefs.countingMode, prefs.overrides, prefs.goal])

  const go = (next: number) => void navigate({ to: '/welcome', search: { step: next } })

  const skip = () => {
    createBlank()
    void navigate({ to: '/', replace: true })
  }

  const finish = () => {
    prefs.setEquipment(equip)
    if (template) {
      const { notes } = createFromTemplate(template, trainingDays, equip, catalog)
      const dropped = notes.filter((n) => n.kind === 'dropped_slot').length
      if (dropped) showToast({ message: `${countLabel(dropped, 'slot')} left out for your equipment. You can add others on each day.` })
    } else {
      createBlank(undefined, trainingDays)
    }
    void navigate({ to: '/', replace: true })
  }

  const heading =
    step === 1 ? `Plan your week with ${APP_NAME}` : step === 2 ? 'Which days do you train?' : 'What can you use?'
  const sub =
    step === 1
      ? 'Start from a split and adjust it, or fill seven empty days yourself. The map shows how much each muscle gets.'
      : step === 2
        ? 'Pick the days you plan to train. The others become rest days.'
        : 'Exercises that need equipment you do not have are left out.'

  return (
    <Page>
      <div className="pt-safe">
        <PageBody className="flex h-16 items-center justify-between">
          <BrandMark size={32} />
          <Button variant="ghost" size="sm" onClick={skip}>
            Skip
          </Button>
        </PageBody>
      </div>
      <PageBody className="pt-2">
        <div className="flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={cx('h-1 flex-1 rounded-full', i < step ? 'bg-ink' : 'bg-line')} />
          ))}
        </div>
        <p className="num mt-4 text-sm text-ink-2">
          Step {step} of {STEPS}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-[-0.022em]">{heading}</h1>
        <p className="mt-2 text-base text-ink-2">{sub}</p>

        <div className="mt-6">
          {step === 1 && gaps && <p className="mb-3 text-sm text-ink-2">{gaps}</p>}
          {step === 1 && (
            <ul className="space-y-3">
              {splits.map((s) => {
                const p = previews.get(s.id)
                return (
                  <li key={s.id}>
                    <TemplateCard
                      title={s.name}
                      meta={joinMeta([`${s.daysPerWeek} days a week`, LEVEL_LABEL[s.level]])}
                      description={s.description}
                      footnote={p && joinMeta([`${p.trained} of ${p.total} groups`, `${p.sets} sets a week`])}
                      weekly={p?.weekly}
                      selected={choice === s.id}
                      onSelect={() => {
                        setChoice(s.id)
                        setDays(null)
                      }}
                    />
                  </li>
                )
              })}
              <li>
                <TemplateCard
                  title="Start blank"
                  meta="Seven empty days"
                  description="Add exercises day by day and watch the map fill in."
                  selected={choice === BLANK}
                  onSelect={() => {
                    setChoice(BLANK)
                    setDays(null)
                  }}
                />
              </li>
            </ul>
          )}

          {step === 2 && (
            <>
              <DayPicker label="Training days" value={trainingDays} onChange={setDays} hints={sessionHints(template, trainingDays)} />
              <p className="mt-4 text-sm text-ink-2">
                {trainingDays.length === 0
                  ? 'Pick at least one day.'
                  : template && trainingDays.length !== template.daysPerWeek
                    ? `${template.name} is built for ${template.daysPerWeek} days a week. On ${trainingDays.length} ${plural(trainingDays.length, 'day')} its sessions repeat in order.`
                    : `${countLabel(trainingDays.length, 'training day')}, ${countLabel(7 - trainingDays.length, 'rest day')}.`}
              </p>
            </>
          )}

          {step === 3 && (
            <>
              <ul className="space-y-2" role="radiogroup" aria-label="Equipment">
                {[...presets.map((p) => ({ id: p.id, name: p.name, count: p.equipment.length })), { id: 'custom', name: 'Custom', count: -1 }].map(
                  (p) => {
                    const selected = p.id === 'custom' ? preset === null : preset === p.id
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => {
                            if (p.id === 'custom') setCustom(true)
                            else {
                              setCustom(false)
                              setEquip(presetEquipment(p.id))
                            }
                          }}
                          className={cx(
                            'flex min-h-14 w-full items-center gap-3 rounded-xl border-2 bg-surface px-4 text-left transition-colors',
                            selected ? 'border-ink' : 'border-transparent hover:border-line-strong',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-base font-medium">{p.name}</span>
                            <span className="num block text-sm text-ink-2">
                              {p.count < 0
                                ? selected
                                  ? `${equip.length} of ${allEquipment.length} items`
                                  : 'Pick items one by one'
                                : p.count === 0
                                  ? 'No equipment'
                                  : `${p.count} of ${allEquipment.length} items`}
                            </span>
                          </span>
                          <span
                            aria-hidden
                            className={cx('size-5 shrink-0 rounded-full border-2', selected ? 'border-ink bg-ink ring-4 ring-surface ring-inset' : 'border-line-strong')}
                          />
                        </button>
                      </li>
                    )
                  },
                )}
              </ul>
              {gaps && <p className="mt-4 text-sm text-ink-2">{gaps}</p>}
              {preset === null && <EquipmentChecklist className="mt-4" value={equip} onChange={setEquip} />}
            </>
          )}
        </div>

        <p className="mt-8 text-xs text-ink-3">{NOT_MEDICAL_ADVICE}</p>
      </PageBody>

      <StickyActions>
        {step > 1 && (
          <Button size="lg" onClick={() => (router.history.canGoBack() ? router.history.back() : go(step - 1))}>
            Back
          </Button>
        )}
        {step < STEPS ? (
          <Button variant="primary" size="lg" block disabled={step === 2 && trainingDays.length === 0} onClick={() => go(step + 1)}>
            Continue
          </Button>
        ) : (
          <Button variant="primary" size="lg" block onClick={finish}>
            Show my week
          </Button>
        )}
      </StickyActions>
    </Page>
  )
}

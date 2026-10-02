import { getRouteApi, useNavigate, useRouter } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { NotMedicalAdvice } from '../../app/brand'
import { BrandMark } from '../../app/BrandMark'
import { sortDays, type DayIndex } from '../../app/days'
import { joinMeta } from '../../app/format'
import { gapNote } from '../../app/knownGaps'
import { useCatalog } from '../../app/useCatalog'
import { computeCoverage } from '../../domain/coverage'
import { sequentialIds } from '../../domain/ids'
import { applyTemplate } from '../../domain/program'
import type { SplitTemplate } from '../../domain/schema'
import { computeWeek } from '../../domain/volume'
import { getMessages, useLocale, useMessages } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { useProgramStore } from '../../store/program.store'
import { DayPicker } from '../builder'
import { EquipmentPicker } from '../settings/EquipmentPicker'
import { Button, LanguageToggle, Page, PageBody, StickyActions, cx, showToast } from '../../ui'
import { welcomeMessages } from './messages'
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
  const m = useMessages(welcomeMessages)
  const locale = useLocale()

  const template = choice === BLANK ? undefined : splitById.get(choice)
  const trainingDays = days ?? template?.defaultDays ?? [0, 2, 4]
  const gaps = gapNote(equip, locale)

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
      if (dropped) showToast({ message: getMessages(welcomeMessages).dropped(dropped) })
    } else {
      createBlank(undefined, trainingDays)
    }
    void navigate({ to: '/', replace: true })
  }

  const stepKey = step === 1 ? 1 : step === 2 ? 2 : 3
  const heading = m.heading[stepKey]
  const sub = m.sub[stepKey]

  return (
    <Page>
      <div className="pt-safe">
        <PageBody className="flex h-16 items-center justify-between">
          <BrandMark size={32} />
          <div className="flex items-center gap-2">
            {step === 1 && <LanguageToggle />}
            <Button variant="ghost" size="sm" onClick={skip}>
              {m.skip}
            </Button>
          </div>
        </PageBody>
      </div>
      <PageBody className="pt-2">
        <div className="flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={cx('h-1 flex-1 rounded-full', i < step ? 'bg-ink' : 'bg-line')} />
          ))}
        </div>
        <p className="num mt-4 text-sm text-ink-2">
          {m.step(step, STEPS)}
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
                      meta={joinMeta([m.daysAWeek(s.daysPerWeek), m.level[s.level]])}
                      description={s.description}
                      footnote={p && joinMeta([m.groupsOf(p.trained, p.total), m.setsAWeek(p.sets)])}
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
                  title={m.startBlank}
                  meta={m.sevenEmpty}
                  description={m.blankDescription}
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
              <DayPicker label={m.trainingDays} value={trainingDays} onChange={setDays} hints={sessionHints(template, trainingDays)} />
              <p className="mt-4 text-sm text-ink-2">
                {trainingDays.length === 0
                  ? m.pickOne
                  : template && trainingDays.length !== template.daysPerWeek
                    ? m.repeats(template.name, template.daysPerWeek, trainingDays.length)
                    : m.daySplit(trainingDays.length, 7 - trainingDays.length)}
              </p>
            </>
          )}

          {step === 3 && <EquipmentPicker value={equip} onChange={setEquip} />}
        </div>

        <p className="mt-8 text-xs text-ink-3"><NotMedicalAdvice /></p>
      </PageBody>

      <StickyActions>
        {step > 1 && (
          <Button size="lg" onClick={() => (router.history.canGoBack() ? router.history.back() : go(step - 1))}>
            {m.back}
          </Button>
        )}
        {step < STEPS ? (
          <Button variant="primary" size="lg" block disabled={step === 2 && trainingDays.length === 0} onClick={() => go(step + 1)}>
            {m.continue}
          </Button>
        ) : (
          <Button variant="primary" size="lg" block onClick={finish}>
            {m.showWeek}
          </Button>
        )}
      </StickyActions>
    </Page>
  )
}

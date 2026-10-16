import { useLocation, useNavigate, useRouter } from '@tanstack/react-router'
import { Link2Off } from 'lucide-react'
import { useMemo, useState } from 'react'
import { dayName } from '../../app/days'
import { formatDaySummary, formatRest, formatRir, joinMeta, setsLabel } from '../../app/format'
import { useCatalog } from '../../app/useCatalog'
import { useWeek } from '../../app/useWeek'
import { groupName } from '../../data/localize'
import { decodeProgram } from '../../domain/codec'
import { applyEquipmentSwap, type EquipmentSwap } from '../../domain/equipmentSwap'
import { movementGroupOf } from '../../domain/movement'
import type { Program } from '../../domain/schema'
import { common } from '../../i18n/common'
import { getMessages, useLocale, useMessages } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { useProgramStore } from '../../store/program.store'
import { Button, EmptyState, LinkButton, MovementMix, MovementSwatch, Page, PageBody, PageHeader, Panel, Section, StickyActions, showToast } from '../../ui'
import { uiMessages } from '../../ui/messages'
import { BodyMini } from '../bodymap'
import { EquipmentSwapPanel } from '../shared/EquipmentSwapPanel'
import { supersetLabels } from '../shared/exercise'
import { exerciseFor } from '../shared/lookup'
import { sharedMessages } from '../shared/messages'
import { shareMessages } from './messages'
import { uniqueName } from './names'
import { exerciseName, isKnown } from './resolveNames'

/** Read-only preview of a program from a share link. Saving always creates a new program. */
export function SharedPreview() {
  const hash = useLocation({ select: (l) => l.hash })
  const { catalog, replacedBy } = useCatalog()
  const result = useMemo(() => decodeProgram(hash, { replacedBy }), [hash, replacedBy])
  // Swaps edit the preview only; saving keeps them. Keyed by the link so another link starts fresh.
  const [swapped, setSwapped] = useState<{ hash: string; program: Program } | null>(null)
  const program = result.ok ? (swapped?.hash === hash ? swapped.program : result.program) : null
  const view = useWeek(program)
  const equipment = usePrefsStore((s) => s.equipment)
  const importProgram = useProgramStore((s) => s.importProgram)
  const programs = useProgramStore((s) => s.programs)
  const navigate = useNavigate()
  const router = useRouter()
  const m = useMessages(shareMessages)
  const swapText = useMessages(sharedMessages).swap
  const ui = useMessages(uiMessages)
  const locale = useLocale()

  const close = () => {
    if (router.history.canGoBack()) router.history.back()
    else void navigate({ to: '/', replace: true })
  }

  if (!result.ok || !view) {
    return (
      <Page>
        <PageHeader title={m.sharedProgram} back={{ to: '/', label: m.plan }} />
        <EmptyState
          icon={Link2Off}
          title={m.couldNotOpen}
          actions={
            <LinkButton to="/" variant="primary">
              {m.goToPlan}
            </LinkButton>
          }
        >
          {result.ok ? m.errors.invalid : m.errors[result.error]}
        </EmptyState>
      </Page>
    )
  }

  const { week, coverage, days, order } = view
  const shared = view.program
  const totalSets = days.reduce((s, d) => s + d.hardSets, 0)
  const trainingDays = days.filter((d) => d.kind === 'train').length
  const unknown = shared.days.flatMap((d) => d.entries).filter((e) => !isKnown(e.exerciseId, catalog, shared.custom)).length

  const swap = (swaps: EquipmentSwap[]) => {
    const before = swapped
    setSwapped({ hash, program: applyEquipmentSwap(shared, swaps) })
    const msgs = getMessages(common)
    showToast({
      message: getMessages(sharedMessages).swap.done(swaps.length),
      action: {
        label: msgs.undo,
        onAction: () => {
          setSwapped(before)
          showToast({ message: msgs.undone })
        },
      },
    })
  }

  const save = () => {
    const name = uniqueName(shared.name, Object.values(programs).map((p) => p.name))
    const id = importProgram({ ...shared, name })
    if (!id) {
      showToast({ message: getMessages(shareMessages).saveFailed })
      return
    }
    showToast({ message: getMessages(shareMessages).savedAs(name) })
    void navigate({ to: '/', replace: true })
  }

  return (
    <Page>
      <PageHeader title={shared.name} subtitle={m.subtitle} back={{ to: '/', label: m.plan }} />
      <PageBody>
        <Panel className="flex items-center gap-4 p-4">
          <BodyMini view="both" groups={week.weekly} height={112} label={m.mapLabel} />
          <div className="min-w-0">
            <p className="font-num text-display font-semibold num">
              {coverage.trainedBanded}
              <span className="text-lg font-normal text-ink-3">{m.ofTotal(coverage.totalBanded)}</span>
            </p>
            <p className="mt-1 text-sm text-ink-2">{m.groupsTrained}</p>
            <p className="mt-3 text-sm text-ink-2 num">
              {m.summary(trainingDays, totalSets)}
            </p>
          </div>
        </Panel>
        {coverage.untrained.required.length > 0 && (
          <p className="mt-3 px-1 text-sm text-ink-2">
            {m.notTrained(coverage.untrained.required.map((u) => groupName(u.group, locale)).join(', '))}
          </p>
        )}
        <p className="mt-2 px-1 text-sm text-ink-3">{m.differs}</p>
        <EquipmentSwapPanel
          program={shared}
          available={equipment}
          describe={swapText.needOther}
          onApply={swap}
          className="mt-4"
        />

        <Section title={ui.byMovement} className="mt-6">
          <Panel className="p-4">
            <MovementMix mix={view.mix} legend />
          </Panel>
        </Section>

        <Section title={m.week} className="mt-6">
          <Panel as="ul" className="divide-y divide-line">
            {order.map((d) => {
              const s = days[d]
              const entries = shared.days[d].entries
              const pairs = supersetLabels(entries)
              return (
                <li key={d} className="px-4 py-3">
                  <div className="flex items-baseline gap-3">
                    <span className="w-10 shrink-0 font-semibold">{dayName(d, 'short', locale)}</span>
                    <span className="min-w-0 flex-1 truncate">{s.kind === 'rest' ? m.rest : (s.label ?? m.training)}</span>
                    {s.kind === 'train' && (
                      <span className="shrink-0 text-sm text-ink-2 num">{formatDaySummary(s.exercises, s.hardSets, locale, s.estMinutes)}</span>
                    )}
                  </div>
                  {s.kind === 'train' && entries.length > 0 && <MovementMix mix={s.mix} className="mt-2 pl-[3.25rem]" />}
                  {s.kind === 'train' && entries.length > 0 && (
                    <ul className="mt-2 space-y-1 pl-[3.25rem] text-sm">
                      {entries.map((e, i) => {
                        const ex = exerciseFor(e.exerciseId, catalog, shared)
                        return (
                          <li key={e.id} className="flex gap-3">
                            <span className="min-w-0 flex-1 text-ink">
                              <MovementSwatch group={movementGroupOf(ex && 'pattern' in ex ? ex.pattern : null)} className="mr-2 align-[0.05em]" />
                              {pairs[i] && <span className="mr-1.5 font-semibold num">{pairs[i].label}</span>}
                              {exerciseName(e.exerciseId, catalog, shared.custom, locale)}
                            </span>
                            <span className="shrink-0 text-ink-2 num">
                              {joinMeta([
                                e.reps ? `${e.sets} × ${e.reps}` : setsLabel(e.sets, locale),
                                e.restSec !== undefined && formatRest(e.restSec, locale),
                                e.rir !== undefined && formatRir(e.rir, locale),
                              ])}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {s.note && <p className="mt-1.5 pl-[3.25rem] text-sm text-ink-3">{s.note}</p>}
                </li>
              )
            })}
          </Panel>
        </Section>
        {unknown > 0 && (
          <p className="mt-3 px-1 text-sm text-ink-2">
            {m.unknown(unknown)}
          </p>
        )}
      </PageBody>
      <StickyActions>
        <Button variant="secondary" size="lg" onClick={close}>
          {m.close}
        </Button>
        <Button variant="primary" size="lg" block onClick={save}>
          {m.save}
        </Button>
      </StickyActions>
    </Page>
  )
}

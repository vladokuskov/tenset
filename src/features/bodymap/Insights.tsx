import { formatSets } from '../../app/format'
import type { Coverage } from '../../domain/coverage'
import { useLocale } from '../../i18n/messages'
import { Panel, Section } from '../../ui/Page'
import { bodymapMessages } from './messages'
import { Why } from './Why'

function Pair({ a, b, labelA, labelB }: { a: number; b: number; labelA: string; labelB: string }) {
  const locale = useLocale()
  return (
    <p className="num text-lg text-ink">
      <span className="text-ink-2">{labelA}</span> {formatSets(a, locale)}
      <span className="mx-1.5 text-ink-3">/</span>
      <span className="text-ink-2">{labelB}</span> {formatSets(b, locale)}
    </p>
  )
}

/** Balance as plain numbers and patterns not in the week. Never pass/fail. */
export function Insights({ coverage }: { coverage: Coverage }) {
  const { pushPull, quadHamstring } = coverage.balance
  const m = bodymapMessages[useLocale()]
  return (
    <Section title={m.balance} description={m.balanceDescription}>
      <Panel as="ul" className="divide-y divide-line">
        <li className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink-2">{m.pushPullTitle}</p>
            <Pair labelA={m.push} a={pushPull.push} labelB={m.pull} b={pushPull.pull} />
          </div>
          <Why topic={m.pushPullTopic} sources={[pushPull.sourceId]}>
            {m.pushPullBody}
          </Why>
        </li>
        <li className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink-2">{m.thighTitle}</p>
            <Pair labelA={m.quads} a={quadHamstring.quads} labelB={m.hamstrings} b={quadHamstring.hamstrings} />
          </div>
          <Why topic={m.thighTopic} sources={[quadHamstring.sourceId]}>
            {m.thighBody}
          </Why>
        </li>
        {coverage.strength.map((s) => (
          <li key={s.pattern} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-2">{m.strengthGoal}</p>
              <p className="text-base text-ink">{m.strengthDays(m.mainPattern[s.pattern], s.days)}</p>
            </div>
            <Why topic={m.frequencyTopic(m.mainPattern[s.pattern])} sources={[s.sourceId]}>
              {m.frequencyBody}
            </Why>
          </li>
        ))}
      </Panel>

      {coverage.missingPatterns.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 px-1 text-sm font-medium text-ink-2">{m.notInWeek}</h3>
          <Panel as="ul" className="divide-y divide-line">
            {coverage.missingPatterns.map((p) => {
              const copy = m.missingPattern[p.kind]
              return (
                <li key={p.kind} className="flex min-h-13 items-center gap-3 px-4 py-2.5">
                  <p className="min-w-0 flex-1 text-base text-ink">
                    {copy.label}
                    <span className="text-ink-2"> · {copy.examples}</span>
                  </p>
                  <Why topic={copy.label} sources={[p.sourceId]}>
                    {copy.why} {m.checklist}
                  </Why>
                </li>
              )
            })}
          </Panel>
        </>
      )}
    </Section>
  )
}

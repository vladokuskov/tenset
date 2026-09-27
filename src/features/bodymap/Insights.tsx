import { formatSets } from '../../app/format'
import type { Coverage } from '../../domain/coverage'
import { Panel, Section } from '../../ui/Page'
import { MAIN_PATTERN_LABEL, MISSING_PATTERN } from './copy'
import { Why } from './Why'

function Pair({ a, b, labelA, labelB }: { a: number; b: number; labelA: string; labelB: string }) {
  return (
    <p className="num text-lg text-ink">
      <span className="text-ink-2">{labelA}</span> {formatSets(a)}
      <span className="mx-1.5 text-ink-3">/</span>
      <span className="text-ink-2">{labelB}</span> {formatSets(b)}
    </p>
  )
}

/** Balance as plain numbers and patterns not in the week. Never pass/fail. */
export function Insights({ coverage }: { coverage: Coverage }) {
  const { pushPull, quadHamstring } = coverage.balance
  return (
    <Section title="Balance" description="Side-by-side counts, not rules.">
      <Panel as="ul" className="divide-y divide-line">
        <li className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink-2">Push and pull, hard sets</p>
            <Pair labelA="push" a={pushPull.push} labelB="pull" b={pushPull.pull} />
          </div>
          <Why topic="Push and pull" sources={[pushPull.sourceId]}>
            Hard sets of pressing (flat, incline, overhead, dips) next to pulling (rows, pull-ups, pulldowns). There is
            no target ratio here, only the two counts.
          </Why>
        </li>
        <li className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink-2">Front and back of the thigh, weekly sets</p>
            <Pair labelA="quads" a={quadHamstring.quads} labelB="hamstrings" b={quadHamstring.hamstrings} />
          </div>
          <Why topic="Quads and hamstrings" sources={[quadHamstring.sourceId]}>
            Weekly fractional sets for each group, shown side by side.
          </Why>
        </li>
        {coverage.strength.map((s) => (
          <li key={s.pattern} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-2">Strength goal</p>
              <p className="text-base text-ink">
                {MAIN_PATTERN_LABEL[s.pattern]} on {s.days} {s.days === 1 ? 'day' : 'days'} a week
              </p>
            </div>
            <Why topic={`${MAIN_PATTERN_LABEL[s.pattern]} frequency`} sources={[s.sourceId]}>
              With a strength goal, each main pattern shows how many days it is trained. Two or more days is the usual
              reference point.
            </Why>
          </li>
        ))}
      </Panel>

      {coverage.missingPatterns.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 px-1 text-sm font-medium text-ink-2">Not in this week</h3>
          <Panel as="ul" className="divide-y divide-line">
            {coverage.missingPatterns.map((m) => {
              const copy = MISSING_PATTERN[m.kind]
              return (
                <li key={m.kind} className="flex min-h-13 items-center gap-3 px-4 py-2.5">
                  <p className="min-w-0 flex-1 text-base text-ink">
                    {copy.label}
                    <span className="text-ink-2"> · {copy.examples}</span>
                  </p>
                  <Why topic={copy.label} sources={[m.sourceId]}>
                    {copy.why} The checklist is a quick way to spot a movement the week leaves out.
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

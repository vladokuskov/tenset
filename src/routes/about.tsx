import { Link, createFileRoute } from '@tanstack/react-router'
import { APP_NAME, notMedicalAdvice } from '../app/brand'
import { BrandMark } from '../app/BrandMark'
import { BAND_ORDER, bandLabel, bandRange, targetText } from '../app/bands'
import { taxonomy, groups } from '../domain/taxonomy'
import { useLocale, useMessages } from '../i18n/messages'
import { sources } from '../features/catalog/detail'
import { Page, PageBody, PageHeader, Panel, Section } from '../ui'
import { aboutMessages, rootMessages } from './-messages'

export const Route = createFileRoute('/about')({
  component: AboutPage,
})

const DEFAULT_EDGES = taxonomy.bandEdgesDefault
const custom = groups.filter((g) => g.banded && !g.optional && g.bandEdges)
const optional = groups.filter((g) => g.banded && g.optional)
const tracked = groups.filter((g) => !g.banded)
const link = 'text-accent underline underline-offset-2'

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function AboutPage() {
  const locale = useLocale()
  const m = useMessages(aboutMessages)
  const plan = useMessages(rootMessages).plan
  return (
    <Page>
      <PageHeader title={m.title} back={{ to: '/', label: plan }} />
      <PageBody className="text-base leading-relaxed text-ink-2">
        <div className="flex items-center gap-3 px-1">
          <BrandMark size={48} />
          <p className="text-lg font-semibold text-ink">{APP_NAME}</p>
        </div>
        <p className="mt-4 px-1">{m.intro}</p>

        <Section title={m.notMedicalTitle} className="mt-7">
          <p className="px-1">
            {notMedicalAdvice(locale)} {m.notMedicalBody}
          </p>
        </Section>

        <Section title={m.numbersTitle}>
          <div className="space-y-3 px-1">
            <p>
              <strong className="font-semibold text-ink">{m.hardSetsLead}</strong> {m.hardSets}
            </p>
            <p>
              <strong className="font-semibold text-ink">{m.fractionalLead}</strong> {m.fractional}
            </p>
            <p>
              <strong className="font-semibold text-ink">{m.bandsLead}</strong> {m.bands}
            </p>
          </div>
          <Panel as="ul" className="mt-3 divide-y divide-line">
            {BAND_ORDER.map((band) => (
              <li key={band} className="flex gap-4 px-4 py-2.5">
                <span className="w-28 shrink-0 font-medium text-ink">{capitalize(bandLabel(band, {}, locale))}</span>
                <span className="min-w-0">
                  <span className="num">{bandRange(band, DEFAULT_EDGES, locale)}</span>
                  {m.bandNote[band] && <span className="block text-sm text-ink-3">{m.bandNote[band]}</span>}
                </span>
              </li>
            ))}
          </Panel>
          <div className="mt-3 space-y-3 px-1 text-sm">
            <p>{m.customRanges(custom.map((g) => ({ id: g.id, target: targetText(g.bandEdges!, {}, locale) })))}</p>
            <p>
              {m.optionalGroups(
                optional.map((g) => g.id),
                targetText(optional[0]?.bandEdges ?? [4, 6, 16, 26], {}, locale),
                optional[0]?.bandEdges?.[0] ?? 4,
              )}{' '}
              {m.trackedGroups(tracked.map((g) => g.id))}
            </p>
            <p>
              <strong className="font-semibold text-ink">{m.mapLead}</strong> {m.map}
            </p>
            <p>
              <strong className="font-semibold text-ink">{m.daysLead}</strong> {m.days}
            </p>
          </div>
        </Section>

        <div id="sources" className="scroll-mt-20">
          <Section title={m.sourcesTitle} description={m.sourcesDescription}>
            <Panel as="ul" className="divide-y divide-line text-sm">
              {sources.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <p className="text-ink">{s.cite}</p>
                  {s.use && <p className="mt-1 text-ink-3">
                      {m.usedFor} {s.use}
                    </p>}
                  {s.pmid && (
                    <a href={`https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/`} className={`mt-1 inline-block ${link}`} rel="noreferrer" target="_blank">
                      PubMed {s.pmid}
                    </a>
                  )}
                </li>
              ))}
            </Panel>
            <p className="mt-3 px-1 text-sm">{m.sourcesNote}</p>
          </Section>
        </div>

        <p className="mt-8 px-1 text-sm">
          <Link to="/credits" className={link}>
            {m.credits}
          </Link>
          <span className="text-ink-3"> · </span>
          <Link to="/privacy" className={link}>
            {m.privacy}
          </Link>
        </p>
      </PageBody>
    </Page>
  )
}

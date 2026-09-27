import { Link, createFileRoute } from '@tanstack/react-router'
import { APP_NAME, NOT_MEDICAL_ADVICE } from '../app/brand'
import { BrandMark } from '../app/BrandMark'
import { bandRange, targetText } from '../app/bands'
import { taxonomy, groups } from '../domain/taxonomy'
import type { BandId } from '../domain/volume'
import { sources } from '../features/catalog/detail'
import { Page, PageBody, PageHeader, Panel, Section } from '../ui'

export const Route = createFileRoute('/about')({
  component: AboutPage,
})

const DEFAULT_EDGES = taxonomy.bandEdgesDefault
const BANDS: { band: BandId; label: string; note?: string }[] = [
  { band: 'none', label: 'Not trained' },
  { band: 'light', label: 'Light' },
  { band: 'moderate', label: 'Moderate', note: 'reads as good for general fitness under the General goal' },
  { band: 'target', label: 'Target range', note: 'the range most muscle growth studies use' },
  { band: 'high', label: 'High', note: 'each extra set adds less than the ones before it' },
  { band: 'very_high', label: 'Very high' },
]
const custom = groups.filter((g) => g.banded && !g.optional && g.bandEdges)
const optional = groups.filter((g) => g.banded && g.optional)
const tracked = groups.filter((g) => !g.banded)
const link = 'text-accent underline underline-offset-2'

function AboutPage() {
  return (
    <Page>
      <PageHeader title="About" back={{ to: '/', label: 'Plan' }} />
      <PageBody className="text-base leading-relaxed text-ink-2">
        <div className="flex items-center gap-3 px-1">
          <BrandMark size={48} />
          <p className="text-lg font-semibold text-ink">{APP_NAME}</p>
        </div>
        <p className="mt-4 px-1">
          Plan a weekly gym program and see which muscles each day and the whole week train, down to individual muscle
          heads. Everything runs in your browser and stays on your device.
        </p>

        <Section title="Not medical advice" className="mt-7">
          <p className="px-1">
            {NOT_MEDICAL_ADVICE} The app helps you lay out a training week. It does not diagnose, treat or prevent any
            injury or condition, and it is not a rehabilitation tool. If you have an injury, pain or a health condition,
            talk to a qualified professional about what suits you.
          </p>
        </Section>

        <Section title="What the numbers mean">
          <div className="space-y-3 px-1">
            <p>
              <strong className="font-semibold text-ink">Hard sets.</strong> Working sets taken reasonably close to
              failure. Warm-up sets are not counted. One-sided exercises count each set once, not per side.
            </p>
            <p>
              <strong className="font-semibold text-ink">Fractional counting.</strong> A set counts 1 for each primary
              muscle group and 0.5 for each secondary one, following Pelland et al. 2026. The "primary only" setting counts
              secondary muscles as 0. Muscles that only stabilize count 0.
            </p>
            <p>
              <strong className="font-semibold text-ink">Weekly bands.</strong> Each muscle group's weekly sets fall into
              a band. The words are neutral labels, not grades.
            </p>
          </div>
          <Panel as="ul" className="mt-3 divide-y divide-line">
            {BANDS.map((b) => (
              <li key={b.band} className="flex gap-4 px-4 py-2.5">
                <span className="w-28 shrink-0 font-medium text-ink">{b.label}</span>
                <span className="min-w-0">
                  <span className="num">{bandRange(b.band, DEFAULT_EDGES)}</span>
                  {b.note && <span className="block text-sm text-ink-3">{b.note}</span>}
                </span>
              </li>
            ))}
          </Panel>
          <div className="mt-3 space-y-3 px-1 text-sm">
            <p>
              Some groups use their own ranges, labeled expert opinion:{' '}
              {custom.map((g) => `${g.name.toLowerCase()} ${targetText(g.bandEdges!)}`).join(', ')}.
            </p>
            <p>
              Optional groups ({optional.map((g) => g.name.toLowerCase()).join(', ')}) show "{targetText(optional[0]?.bandEdges ?? [4, 6, 16, 26])}"
              and never read as light. {tracked.map((g) => g.name).join(', ')} are tracked as a number only, without a
              band.
            </p>
            <p>
              <strong className="font-semibold text-ink">Map colors.</strong> One color, from light to strong, follows
              the same bands. The week scale uses weekly sets; the day scale uses one session. Heads are shaded by how
              much each exercise emphasizes them and never get a band.
            </p>
            <p>
              <strong className="font-semibold text-ink">Training days per muscle.</strong> The app lists the days a
              group gets 2 or more sets and the gaps between them. It is information only.
            </p>
          </div>
        </Section>

        <div id="sources" className="scroll-mt-20">
          <Section title="Sources" description="Studies and references behind muscle roles and set ranges.">
            <Panel as="ul" className="divide-y divide-line text-sm">
              {sources.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <p className="text-ink">{s.cite}</p>
                  {s.use && <p className="mt-1 text-ink-3">Used for: {s.use}</p>}
                  {s.pmid && (
                    <a href={`https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/`} className={`mt-1 inline-block ${link}`} rel="noreferrer" target="_blank">
                      PubMed {s.pmid}
                    </a>
                  )}
                </li>
              ))}
            </Panel>
            <p className="mt-3 px-1 text-sm">
              Muscle roles are our own mapping. Where no study backs a call, the exercise says so with a low or medium
              confidence.
            </p>
          </Section>
        </div>

        <p className="mt-8 px-1 text-sm">
          <Link to="/credits" className={link}>
            Credits and licenses
          </Link>
          <span className="text-ink-3"> · </span>
          <Link to="/privacy" className={link}>
            Privacy
          </Link>
        </p>
      </PageBody>
    </Page>
  )
}

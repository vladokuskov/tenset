import { Link, createFileRoute } from '@tanstack/react-router'
import { useMessages } from '../i18n/messages'
import { Page, PageBody, PageHeader, Placeholder, Section } from '../ui'
import { privacyMessages, rootMessages } from './-messages'

export const Route = createFileRoute('/privacy')({
  component: PrivacyPage,
})

// Filled in by the operator before public launch.
const OPERATOR = null as { name: string; contact: string } | null

const link = 'text-accent underline underline-offset-2'
const list = 'mt-2 list-disc space-y-1.5 pl-5 marker:text-ink-3'

function PrivacyPage() {
  const m = useMessages(privacyMessages)
  const back = useMessages(rootMessages).library
  return (
    <Page>
      <PageHeader title={m.title} subtitle={m.subtitle} back={{ to: '/', label: back }} />
      <PageBody className="text-base leading-relaxed text-ink-2">
        <Section title={m.whoTitle}>
          {OPERATOR ? (
            <p className="px-1">{m.contact(OPERATOR.name, OPERATOR.contact)}</p>
          ) : import.meta.env.DEV ? (
            <Placeholder owner="lead">
              <p>{m.operatorPlaceholder}</p>
            </Placeholder>
          ) : (
            <p className="px-1">{m.noOperator}</p>
          )}
        </Section>

        <Section title={m.trackingTitle}>
          <p className="px-1">{m.tracking}</p>
        </Section>

        <Section title={m.storedTitle}>
          <ul className={`${list} px-1`}>
            {m.stored.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-3 px-1">{m.storedNote}</p>
        </Section>

        <Section title={m.deleteTitle}>
          <p className="px-1">{m.delete}</p>
          <p className="mt-3 px-1">{m.deleteSafari}</p>
        </Section>

        <Section title={m.hostingTitle}>
          <p className="px-1">
            {m.hosting(
              <a key="policy" href="https://vercel.com/legal/privacy-policy" className={link} rel="noreferrer" target="_blank">
                {m.vercelPolicy}
              </a>,
            )}
          </p>
        </Section>

        <Section title={m.cookieTitle}>
          <p className="px-1">{m.cookie}</p>
        </Section>

        <p className="mt-8 px-1 text-sm">
          <Link to="/credits" className={link}>
            {m.credits}
          </Link>
        </p>
      </PageBody>
    </Page>
  )
}

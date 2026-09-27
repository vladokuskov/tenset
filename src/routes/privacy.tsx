import { Link, createFileRoute } from '@tanstack/react-router'
import { Page, PageBody, PageHeader, Placeholder, Section } from '../ui'

export const Route = createFileRoute('/privacy')({
  component: PrivacyPage,
})

// Filled in by the operator before public launch.
const OPERATOR = null as { name: string; contact: string } | null

const link = 'text-accent underline underline-offset-2'
const list = 'mt-2 list-disc space-y-1.5 pl-5 marker:text-ink-3'

function PrivacyPage() {
  return (
    <Page>
      <PageHeader title="Privacy" subtitle="Short version: your programs never leave your device unless you share them." back={{ to: '/', label: 'Plan' }} />
      <PageBody className="text-base leading-relaxed text-ink-2">
        <Section title="Who runs this app">
          {OPERATOR ? (
            <p className="px-1">
              {OPERATOR.name}. Contact: {OPERATOR.contact}
            </p>
          ) : (
            <Placeholder owner="lead">
              <p>Operator name and contact details go here before public launch.</p>
            </Placeholder>
          )}
        </Section>

        <Section title="No accounts, no tracking">
          <p className="px-1">
            There is no sign-up, no server database, no analytics, no ads and no cookies. The app never loads anything
            from other companies' servers while you use it.
          </p>
        </Section>

        <Section title="What is stored on this device">
          <ul className={`${list} px-1`}>
            <li>Your programs, including custom exercises, day labels and notes.</li>
            <li>Your settings: goal, equipment, counting mode, week start and "Edit how this counts" changes.</li>
            <li>Small flags, for example whether you dismissed the install card.</li>
            <li>An offline copy of the app's own files, so it opens without a connection.</li>
          </ul>
          <p className="mt-3 px-1">
            This lives in your browser's storage for this site. Nobody else can read it, including us. Nothing here is
            sent anywhere unless you export a file or share a link.
          </p>
        </Section>

        <Section title="How to delete it">
          <p className="px-1">
            Remove the site data for this site in your browser settings. On iPhone and iPad: Settings, Safari, Advanced,
            Website Data. In Chrome: Settings, Privacy and security, Site settings. If you added the app to your Home
            Screen, deleting the app removes its data too. Export a backup first if you want to keep your programs.
          </p>
          <p className="mt-3 px-1">
            Safari may also clear data for sites you have not opened for 7 days. Apps added to the Home Screen are not
            affected.
          </p>
        </Section>

        <Section title="Share links">
          <p className="px-1">
            A share link carries the whole program in the part of the address after the #. Browsers do not send that part
            to any server, so the program is not uploaded or stored anywhere. Anyone who has the link can read the
            program, including its name, day labels, notes and custom exercise names.
          </p>
        </Section>

        <Section title="Hosting">
          <p className="px-1">
            The app's files are served by Cloudflare, Inc. as a processor on our behalf. To deliver them, Cloudflare
            handles standard request data such as your IP address, browser type, the address requested and the time,
            and may keep it briefly in logs for security and reliability. See{' '}
            <a href="https://www.cloudflare.com/privacypolicy/" className={link} rel="noreferrer" target="_blank">
              Cloudflare's privacy policy
            </a>
            .
          </p>
        </Section>

        <Section title="Why there is no cookie banner">
          <p className="px-1">
            The storage above is strictly needed for the app to work and stays on your device, so no consent is
            required. If analytics or anything similar is ever added, this page will change first.
          </p>
        </Section>

        <p className="mt-8 px-1 text-sm">
          <Link to="/about" className={link}>
            About the app
          </Link>
          <span className="text-ink-3"> · </span>
          <Link to="/credits" className={link}>
            Credits
          </Link>
        </p>
      </PageBody>
    </Page>
  )
}

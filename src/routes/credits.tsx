import { Link, createFileRoute } from '@tanstack/react-router'
import { Fragment, type ReactNode } from 'react'
import attribution from '../../ATTRIBUTION.md?raw'
import { Page, PageBody, PageHeader } from '../ui'

export const Route = createFileRoute('/credits')({
  component: CreditsPage,
})

const NOTICES = 'THIRD_PARTY_NOTICES.txt'
const linkClass = 'break-words text-accent underline underline-offset-2'

// Inline markdown: [text](url), **bold**, `code`, bare URLs and the notices file name.
const INLINE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s)]+[^\s).,;])|(THIRD_PARTY_NOTICES\.txt)/g

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0
    if (i > last) out.push(<Fragment key={`t${i}`}>{text.slice(last, i)}</Fragment>)
    const [, label, href, bold, code, url, notices] = m
    if (href) out.push(<a key={i} href={href} className={linkClass} rel="noreferrer" target="_blank">{label}</a>)
    else if (bold) out.push(<strong key={i} className="font-semibold text-ink">{bold}</strong>)
    else if (code) out.push(<code key={i} className="rounded bg-surface-2 px-1 text-[0.9em]">{code}</code>)
    else if (url) out.push(<a key={i} href={url} className={`${linkClass} break-all`} rel="noreferrer" target="_blank">{url}</a>)
    else if (notices) out.push(<a key={i} href={`${import.meta.env.BASE_URL}${NOTICES}`} className={linkClass}>{notices}</a>)
    last = i + m[0].length
  }
  if (last < text.length) out.push(<Fragment key="end">{text.slice(last)}</Fragment>)
  return out
}

type Block = { kind: 'h2'; text: string } | { kind: 'p'; text: string } | { kind: 'ul'; items: string[] }

// Minimal reader for ATTRIBUTION.md: headings, paragraphs and one-level lists with wrapped lines.
function parse(md: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: string[] | null = null
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') })
    if (list) blocks.push({ kind: 'ul', items: list })
    para = []
    list = null
  }
  for (const line of md.split('\n')) {
    if (!line.trim()) flush()
    else if (line.startsWith('# ')) flush()
    else if (line.startsWith('## ')) {
      flush()
      blocks.push({ kind: 'h2', text: line.slice(3).trim() })
    } else if (/^[-*] /.test(line)) {
      if (para.length) flush()
      list = [...(list ?? []), line.slice(2).trim()]
    } else if (list && /^\s+/.test(line)) list[list.length - 1] += ` ${line.trim()}`
    else {
      if (list) flush()
      para.push(line.trim())
    }
  }
  flush()
  return blocks
}

const blocks = parse(attribution)

function CreditsPage() {
  return (
    <Page>
      <PageHeader title="Credits" back={{ to: '/', label: 'Plan' }} />
      <PageBody className="text-base leading-relaxed">
        {blocks.map((b, i) =>
          b.kind === 'h2' ? (
            <h2 key={i} className="mb-2 mt-8 text-md font-semibold first:mt-0">
              {b.text}
            </h2>
          ) : b.kind === 'p' ? (
            <p key={i} className="mt-2 text-ink-2">
              {inline(b.text)}
            </p>
          ) : (
            <ul key={i} className="mt-2 list-disc space-y-1.5 pl-5 text-ink-2 marker:text-ink-3">
              {b.items.map((it, j) => (
                <li key={j}>{inline(it)}</li>
              ))}
            </ul>
          ),
        )}
        <p className="mt-8 border-t border-line pt-4 text-sm text-ink-2">
          Full license texts of bundled libraries:{' '}
          <a href={`${import.meta.env.BASE_URL}${NOTICES}`} className={linkClass}>
            {NOTICES}
          </a>
          . See also{' '}
          <Link to="/privacy" className={linkClass}>
            privacy
          </Link>{' '}
          and{' '}
          <Link to="/about" className={linkClass}>
            about
          </Link>
          .
        </p>
      </PageBody>
    </Page>
  )
}

import { Link } from '@tanstack/react-router'
import { Check, ChevronLeft, ChevronRight, Circle, ClipboardCheck, RotateCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCatalog } from '../../app/useCatalog'
import type { Exercise } from '../../domain/schema'
import { useIsCustomized } from '../catalog/useRoles'
import { Button, ChipGroup, EmptyState, IconButton, Pill, showToast } from '../../ui'
import { cx } from '../../ui/cx'
import { fetchQueue, postDecision, postRestore } from './api'
import { DecisionBar } from './DecisionBar'
import { countByStatus, FILTERS, matches, pick, step, type StatusFilter } from './queue'
import { CuesCard, MappingCard, ParamsCard } from './ReviewDetails'
import { LivePanel, LoopPanel, SheetPanel } from './ReviewMedia'
import type { Decision, QaStatus, QueueResponse, ReviewFields, ReviewItem } from './types'

export type ReviewSearch = { id?: number; status?: StatusFilter }

type Props = {
  id?: number
  status: StatusFilter
  onNavigate: (search: ReviewSearch) => void
}

const FILTER_LABEL: Record<StatusFilter, string> = { pending: 'Pending', rejected: 'Rejected', approved: 'Approved', all: 'All' }
const STATUS_ICON: Record<QaStatus, typeof Check> = { pending: Circle, approved: Check, rejected: X }

function StatusPill({ fields }: { fields: ReviewFields }) {
  const Icon = STATUS_ICON[fields.motion]
  return (
    <Pill variant={fields.motion === 'pending' ? 'outline' : 'soft'} className={cx('gap-1', fields.motion !== 'pending' && 'text-ink')}>
      <Icon size={12} strokeWidth={2.25} aria-hidden />
      {fields.motion}
    </Pill>
  )
}

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(target.type)
}

/** Owner motion review (dev only): loop, live figure, contact sheet, mapping, cues and params, then approve or reject. */
export default function ReviewPage({ id, status, onNavigate }: Props) {
  const { exercises } = useCatalog()
  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises])
  const [queue, setQueue] = useState<QueueResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [items, setItems] = useState<ReviewItem[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(() => {
    fetchQueue().then(
      (q) => {
        setQueue(q)
        setItems(q.items)
      },
      (e: Error) => setLoadError(e.message),
    )
  }, [])
  useEffect(load, [load])
  const retry = () => {
    setLoadError(null)
    load()
  }

  const current = pick(items, id, status)
  const exercise = current ? byId.get(current.id) : undefined

  // the note follows the shown item and its saved note
  const noteKey = current ? `${current.id}|${current.fields.motion}|${current.fields.note ?? ''}` : ''
  const [note, setNote] = useState(current?.fields.note ?? '')
  const [prevKey, setPrevKey] = useState(noteKey)
  if (noteKey !== prevKey) {
    setPrevKey(noteKey)
    setNote(current?.fields.note ?? '')
    setMessage(null)
  }

  const go = useCallback(
    (next: number | null, filter: StatusFilter = status) => {
      if (next === null) return
      onNavigate({ id: next, status: filter === 'pending' ? undefined : filter })
    },
    [onNavigate, status],
  )

  const counts = countByStatus(items)
  const list = items.filter((i) => matches(i, status) || i.id === current?.id)
  const position = current ? list.findIndex((i) => i.id === current.id) + 1 : 0
  const nextId = step(items, current?.id ?? null, status, 1)
  const prevId = step(items, current?.id ?? null, status, -1)

  const replace = (item: ReviewItem) => {
    const next = items.map((i) => (i.id === item.id ? item : i))
    setItems(next)
    return next
  }

  const undo = async (target: number, fields: ReviewFields) => {
    try {
      const { item } = await postRestore({ id: target, fields })
      setItems((all) => all.map((i) => (i.id === item.id ? item : i)))
      go(target)
    } catch (e) {
      setMessage(`Undo failed: ${(e as Error).message}`)
    }
  }

  const decide = async (decision: Decision) => {
    if (!current || busy) return
    if (decision === 'rejected' && !note.trim()) {
      setMessage('Add a note saying what is wrong, then reject.')
      noteRef.current?.focus()
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const { item, previous } = await postDecision({ id: current.id, decision, note })
      const next = replace(item)
      const name = byId.get(item.id)?.name ?? `#${item.id}`
      showToast({
        message: `${decision === 'approved' ? 'Approved' : 'Rejected'} ${name}`,
        action: { label: 'Undo', onAction: () => void undo(item.id, previous) },
      })
      go(step(next, item.id, status, 1))
    } catch (e) {
      setMessage(`Not saved: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const keys = useRef({ decide, next: () => go(nextId), prev: () => go(prevId) })
  useEffect(() => {
    keys.current = { decide, next: () => go(nextId), prev: () => go(prevId) }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return
      const k = keys.current
      const act = { a: () => k.decide('approved'), r: () => k.decide('rejected'), n: k.next, p: k.prev }[e.key.toLowerCase()]
      if (!act) return
      e.preventDefault()
      void act()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const setFilter = (f: StatusFilter | null) => {
    if (!f) return
    const keep = current && matches(current, f) ? current.id : (items.find((i) => matches(i, f))?.id ?? current?.id)
    onNavigate({ id: keep, status: f === 'pending' ? undefined : f })
  }

  if (loadError) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Review queue unavailable"
        actions={
          <Button icon={RotateCw} onClick={retry}>
            Try again
          </Button>
        }
      >
        {loadError}. The queue is served by the Vite dev server (pnpm dev).
      </EmptyState>
    )
  }
  if (!queue) return <p className="p-6 text-center text-sm text-ink-3">Loading the review queue</p>

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="glass sticky top-0 z-30 border-b border-line pt-safe">
        <div className="mx-auto flex w-full max-w-[90rem] flex-col gap-2 px-gutter py-2">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold max-xl:sr-only">Motion review</h1>
            {items.length > 0 && (
              <select
                aria-label="Jump to exercise"
                value={current?.id ?? ''}
                onChange={(e) => go(Number(e.target.value))}
                className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 text-base text-ink sm:max-w-80 sm:text-sm xl:hidden"
              >
                {list.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.id} {byId.get(i.id)?.name ?? ''}
                  </option>
                ))}
              </select>
            )}
            <span className="flex-1 max-sm:hidden xl:hidden" />
            {current && (
              <span className="num shrink-0 text-sm text-ink-2" aria-live="polite">
                {position} of {list.length}
              </span>
            )}
            <IconButton icon={ChevronLeft} label="Previous (P)" variant="tonal" size={36} onClick={() => go(prevId)} disabled={prevId === null} />
            <IconButton icon={ChevronRight} label="Next (N)" variant="tonal" size={36} onClick={() => go(nextId)} disabled={nextId === null} />
          </div>
          <ChipGroup
            label="Filter by status"
            size="sm"
            scroll
            value={status}
            onChange={setFilter}
            options={FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f], count: counts[f] }))}
          />
        </div>
      </header>

      <div className="mx-auto w-full max-w-[90rem] px-gutter pb-[calc(var(--actions-h)+1.5rem)] pt-4 xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-6">
        <nav aria-label="Queue" className="hidden xl:block">
          <ul className="sticky top-32 max-h-[calc(100dvh-10rem-var(--actions-h))] space-y-0.5 overflow-y-auto">
            {list.map((i) => {
              const Icon = STATUS_ICON[i.fields.motion]
              return (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => go(i.id)}
                    aria-current={i.id === current?.id ? 'true' : undefined}
                    className={cx(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm',
                      i.id === current?.id ? 'bg-surface font-medium text-ink shadow-thumb' : 'text-ink-2 hover:bg-surface-2',
                    )}
                  >
                    <span className="num w-8 shrink-0 text-ink-3">{i.id}</span>
                    <span className="min-w-0 flex-1 truncate">{byId.get(i.id)?.name ?? i.file}</span>
                    <Icon size={14} strokeWidth={2} aria-label={i.fields.motion} className="shrink-0" />
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          <Notices queue={queue} />
          {current && exercise ? (
            <Item item={current} exercise={exercise} filterDone={!matches(current, status) && nextId === null} status={status} />
          ) : current ? (
            <p className="text-sm text-ink">Exercise {current.id} is in the queue but not in the bundled catalog ({current.file} failed validation?).</p>
          ) : (
            <EmptyState icon={ClipboardCheck} title={items.length ? `Nothing ${FILTER_LABEL[status].toLowerCase()}` : 'No exercises with motion'}>
              {items.length ? 'Pick another filter to see the rest.' : 'Bake a motion first.'}
            </EmptyState>
          )}
        </div>
      </div>

      {current && exercise && <DecisionBar ref={noteRef} note={note} onNote={setNote} onDecide={(d) => void decide(d)} busy={busy} message={message} />}
    </div>
  )
}

function Notices({ queue }: { queue: QueueResponse }) {
  const lines: string[] = []
  if (queue.source === 'baked') lines.push('No public/media/manifest.json yet, so the queue lists the baked motion files. Loops show here once they are baked.')
  if (queue.manifestError) lines.push(`The media manifest could not be read: ${queue.manifestError}`)
  if (queue.missing.length) lines.push(`No single readable record for ${queue.missing.join(', ')}.`)
  if (!lines.length) return null
  return (
    <div className="mb-4 space-y-1 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  )
}

function Item({ item, exercise, filterDone, status }: { item: ReviewItem; exercise: Exercise; filterDone: boolean; status: StatusFilter }) {
  const customized = useIsCustomized(exercise)
  return (
    <article>
      {filterDone && (
        <p className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-ink">Nothing left in {FILTER_LABEL[status]}. This is the last one you decided.</p>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="text-xl font-semibold tracking-[-0.01em]">{exercise.name}</h2>
        <StatusPill fields={item.fields} />
        <Pill size="md" variant="outline">
          media: {item.fields.mediaStatus}
        </Pill>
        <span className="num text-sm text-ink-3">{item.file}</span>
        <span className="flex gap-3 text-sm">
          <Link to="/exercise/$slug" params={{ slug: exercise.slug }} className="font-medium text-accent underline-offset-2 hover:underline">
            Detail page
          </Link>
          <a href={`/dev/motion?id=${exercise.id}&live=1`} className="font-medium text-accent underline-offset-2 hover:underline">
            Motion view
          </a>
        </span>
      </div>
      {item.fields.note && (
        <p className="mb-4 rounded-lg border border-line px-3 py-2 text-sm">
          <span className="font-medium">Saved note:</span> {item.fields.note}
        </p>
      )}
      {customized && <p className="mb-4 text-sm text-ink-2">Your local "Edit how this counts" override changes the live figure tint for this exercise.</p>}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        <LoopPanel item={item} />
        <LivePanel exercise={exercise} />
        <div className="md:col-span-2 2xl:col-span-3">
          <SheetPanel item={item} />
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        <MappingCard exercise={exercise} />
        <CuesCard exercise={exercise} />
        <ParamsCard exercise={exercise} />
      </div>
    </article>
  )
}

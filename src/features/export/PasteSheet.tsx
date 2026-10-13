import { Search } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { sortDays } from '../../app/days'
import { useCatalog } from '../../app/useCatalog'
import { groupName } from '../../data/localize'
import { decodeProgram } from '../../domain/codec'
import { randomId } from '../../domain/ids'
import {
  assignDays,
  buildImportedProgram,
  importRefFor,
  parseProgramText,
  type AssignedDay,
  type ImportDay,
  type ImportWarning,
  type ParsedLine,
} from '../../domain/importText'
import { DEFAULT_SETS, NAME_MAX } from '../../domain/program'
import type { CustomExercise, Program } from '../../domain/schema'
import { groups } from '../../domain/taxonomy'
import { compareText } from '../../i18n/format'
import { getMessages, useLocale, useMessages } from '../../i18n/messages'
import { usePrefsStore } from '../../store/prefs.store'
import { programStore, useProgramStore } from '../../store/program.store'
import { Button, Pill, Select, Sheet, showToast } from '../../ui'
import { localReps } from '../shared/exercise'
import { withUniqueNames } from './backup'
import { createMatcher, type MatchCandidate, type MatchConfidence, type Matcher } from './importMatch'
import { exportMessages } from './messages'

export type PasteSheetProps = { open: boolean; onClose: () => void }

type Choice = { kind: 'match'; pick: MatchCandidate } | { kind: 'skip' } | { kind: 'custom'; group: string }
type Row = { key: string; line: ParsedLine; confidence: MatchConfidence; alternatives: MatchCandidate[]; choice: Choice; reviewed: boolean }
type ReviewDay = Omit<AssignedDay, 'lines'> & { rows: Row[] }
type Step =
  | { kind: 'input'; error?: string }
  | { kind: 'link'; program: Program }
  | { kind: 'review'; days: ReviewDay[]; warnings: ImportWarning[] }

const needsCheck = (r: Row) => !r.reviewed && (r.confidence === 'weak' || r.confidence === 'none')

const field = 'w-full rounded-md border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-3'

/** Text from a share link: a full /shared#... URL or the bare fragment. */
function linkFragment(text: string): string | null {
  const t = text.trim()
  if (/\s/.test(t)) return null
  const hash = t.indexOf('#')
  if (hash >= 0) return t.slice(hash + 1)
  return /^[A-Za-z0-9_-]{8,}$/.test(t) ? t : null
}

function review(text: string, matcher: Matcher): Step {
  const parsed = parseProgramText(text)
  const assigned = assignDays(parsed.days)
  let n = 0
  const days = assigned.days.map(({ lines, ...d }) => ({
    ...d,
    rows: lines.map((line): Row => {
      const r = matcher.match(line.name)
      return {
        key: String(n++),
        line,
        // Numbers that read more than one way ("16x3x12") need a look even when the name is sure.
        confidence: line.unsure && r.confidence !== 'none' ? 'weak' : r.confidence,
        alternatives: r.best ? [r.best, ...r.alternatives] : r.alternatives,
        choice: r.best ? { kind: 'match', pick: r.best } : { kind: 'skip' },
        reviewed: false,
      }
    }),
  }))
  if (!days.some((d) => d.rows.length)) return { kind: 'input', error: getMessages(exportMessages).paste.nothingFound }
  return { kind: 'review', days, warnings: [...parsed.warnings, ...assigned.warnings] }
}

/** Paste free text, CSV or a share link; the result is always a new program. */
export function PasteSheet({ open, onClose }: PasteSheetProps) {
  const m = useMessages(exportMessages).paste
  const locale = useLocale()
  const { activeExercises, replacedBy } = useCatalog()
  const custom = useProgramStore((s) => (s.activeId ? s.programs[s.activeId]?.custom : undefined))
  const importProgram = useProgramStore((s) => s.importProgram)
  const weekStart = usePrefsStore((s) => s.weekStart)
  const matcher = useMemo(() => createMatcher(activeExercises, custom ?? [], locale), [activeExercises, custom, locale])
  const inputId = useId()
  const hintId = useId()

  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [step, setStep] = useState<Step>({ kind: 'input' })
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setText('')
      setName('')
      setStep({ kind: 'input' })
    }
  }

  const read = () => {
    const fragment = linkFragment(text)
    if (fragment !== null) {
      const res = decodeProgram(fragment, { replacedBy })
      if (res.ok) {
        setStep({ kind: 'link', program: res.program })
        return
      }
      if (text.includes('#')) {
        setStep({ kind: 'input', error: m.linkBroken })
        return
      }
    }
    setName(m.defaultName)
    setStep(review(text, matcher))
  }

  const save = (program: Program) => {
    const taken = Object.values(programStore.getState().programs).map((p) => p.name)
    const [named] = withUniqueNames([program], taken)
    const id = importProgram(named)
    const msg = getMessages(exportMessages).paste
    if (!id) {
      showToast({ message: msg.createFailed })
      return
    }
    programStore.getState().clearUndo()
    showToast({ message: msg.created(named.name) })
    onClose()
  }

  const create = () => {
    if (step.kind !== 'review') return
    const source: readonly CustomExercise[] = custom ?? []
    const days: ImportDay[] = step.days.map((d) => ({
      day: d.day,
      label: d.label,
      rest: d.rest,
      entries: d.rows.flatMap((r, i) => {
        const { sets, reps, restSec, rir } = r.line
        // A pair only holds when the line it pairs with is kept.
        const withPrev = !!r.line.withPrev && i > 0 && d.rows[i - 1].choice.kind !== 'skip'
        const ref =
          r.choice.kind === 'match'
            ? importRefFor(r.choice.pick.ref, source)
            : r.choice.kind === 'custom'
              ? {
                  custom: {
                    name: r.line.name.slice(0, NAME_MAX),
                    equipment: [],
                    laterality: 'bilateral' as const,
                    groups: r.choice.group ? { [r.choice.group]: 'primary' as const } : {},
                  },
                }
              : null
        // "Row 5 min" matched to a barbell row: a time is no target for a reps exercise.
        const pick = r.choice.kind === 'match' ? r.choice.pick.ref : null
        const timeOnReps = typeof pick === 'number' && !!reps?.endsWith('s') && activeExercises.find((e) => e.id === pick)?.unit === 'reps'
        return ref === null ? [] : [{ ref, sets, reps: timeOnReps ? undefined : reps, restSec, rir, withPrev }]
      }),
    }))
    save(buildImportedProgram('import', name.trim() || m.defaultName, days, () => randomId(8)))
  }

  const setChoice = (key: string, choice: Choice) => {
    if (step.kind !== 'review') return
    setStep({ ...step, days: step.days.map((d) => ({ ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, choice, reviewed: true } : r)) })) })
  }

  const rows = step.kind === 'review' ? step.days.flatMap((d) => d.rows) : []
  const kept = rows.filter((r) => r.choice.kind !== 'skip').length
  const toCheck = rows.filter(needsCheck).length

  const footer =
    step.kind === 'review' ? (
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={() => setStep({ kind: 'input' })}>
          {m.editText}
        </Button>
        <Button variant="primary" className="flex-1" disabled={kept === 0} onClick={create}>
          {m.create}
        </Button>
      </div>
    ) : step.kind === 'link' ? (
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={() => setStep({ kind: 'input' })}>
          {m.editText}
        </Button>
        <Button variant="primary" className="flex-1" onClick={() => save(step.program)}>
          {m.saveLink}
        </Button>
      </div>
    ) : (
      <Button variant="primary" className="w-full" disabled={!text.trim()} onClick={read}>
        {m.read}
      </Button>
    )

  return (
    <Sheet open={open} onClose={onClose} title={m.title} footer={footer}>
      {step.kind === 'input' && (
        <>
          <label htmlFor={inputId} className="block font-medium">
            {m.inputLabel}
          </label>
          <p id={hintId} className="mt-1 text-sm text-ink-2">
            {m.hint}
          </p>
          <textarea
            id={inputId}
            aria-describedby={hintId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={m.placeholder}
            rows={10}
            spellCheck={false}
            autoComplete="off"
            className={`${field} mt-3 min-h-48 resize-y py-2.5 leading-snug`}
          />
          {step.error && (
            <p role="status" className="mt-3 text-sm text-ink">
              {step.error}
            </p>
          )}
        </>
      )}

      {step.kind === 'link' && (
        <div className="rounded-lg bg-surface-2 p-4">
          <p className="text-sm text-ink-2">{m.linkFound}</p>
          <p className="mt-1 font-medium">{step.program.name}</p>
          <p className="mt-0.5 text-sm text-ink-2">
            {m.linkSummary(
              step.program.days.filter((d) => d.kind === 'train').length,
              step.program.days.reduce((n, d) => n + d.entries.length, 0),
            )}
          </p>
        </div>
      )}

      {step.kind === 'review' && (
        <>
          <label className="block">
            <span className="block text-sm font-medium text-ink-2">{m.nameLabel}</span>
            <input
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              className={`${field} mt-1.5 h-11`}
            />
          </label>
          <p role="status" className="mt-3 text-sm text-ink-2">
            {m.summary(rows.length, toCheck)}
          </p>
          <Warnings warnings={step.warnings} />
          {sortDays(
            step.days.map((d) => d.day),
            weekStart,
          ).map((dayIndex) => {
            const d = step.days.find((x) => x.day === dayIndex)!
            return (
              <section key={d.day} className="mt-5">
                <h3 className="font-semibold">{m.day(d.day, d.label)}</h3>
                {d.rest && !d.rows.length ? (
                  <p className="mt-1 text-sm text-ink-2">{m.restDay}</p>
                ) : (
                  <ul className="mt-1 divide-y divide-line">
                    {d.rows.map((r) => (
                      <ReviewRow key={r.key} row={r} matcher={matcher} onChoice={(c) => setChoice(r.key, c)} />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </>
      )}
    </Sheet>
  )
}

function Warnings({ warnings }: { warnings: readonly ImportWarning[] }) {
  const m = useMessages(exportMessages).paste
  if (!warnings.length) return null
  const unreadable = warnings.filter((w) => w.kind === 'unreadable')
  return (
    <ul className="mt-2 space-y-1 text-sm text-ink-2">
      {unreadable.length > 0 && (
        <li>
          {m.unreadable(
            unreadable.length,
            unreadable
              .slice(0, 3)
              .map((w) => m.quote(w.raw.slice(0, 40)))
              .join(', '),
          )}
        </li>
      )}
      {warnings.some((w) => w.kind === 'truncated') && <li>{m.truncated}</li>}
      {warnings.map((w, i) =>
        w.kind === 'extra_days' ? <li key={i}>{m.extraDays(w.count)}</li> : w.kind === 'extra_weeks' ? <li key={i}>{m.extraWeeks(w.count)}</li> : null,
      )}
    </ul>
  )
}

function ReviewRow({ row, matcher, onChoice }: { row: Row; matcher: Matcher; onChoice: (c: Choice) => void }) {
  const m = useMessages(exportMessages).paste
  const locale = useLocale()
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const panelId = useId()
  const { line, choice } = row
  const flagged = needsCheck(row)

  const title =
    choice.kind === 'match' ? choice.pick.name : choice.kind === 'custom' ? m.ownExercise(line.name) : row.confidence === 'none' ? m.noMatch : m.skipped
  const meta = [
    m.setsReps(line.sets ?? DEFAULT_SETS, localReps(line.reps, locale)),
    line.restSec !== undefined ? m.rest(line.restSec) : null,
    line.rir !== undefined ? m.rir(line.rir) : null,
    line.withPrev ? m.superset : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const results = useMemo(() => matcher.search(query), [matcher, query])
  const options = query.trim() ? results : row.alternatives
  const groupOptions = useMemo(
    () => groups.map((g) => ({ id: g.id, name: groupName(g.id, locale) })).sort((a, b) => compareText(locale, a.name, b.name)),
    [locale],
  )

  const pick = (c: MatchCandidate) => {
    onChoice({ kind: 'match', pick: c })
    setExpanded(false)
    setQuery('')
  }

  return (
    <li data-import-row className="py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={choice.kind === 'skip' ? 'font-medium text-ink-2' : 'font-medium text-ink'}>{title}</p>
          <p className="mt-0.5 text-sm text-ink-2">{meta}</p>
          <p className="mt-0.5 truncate text-xs text-ink-3">{m.fromLine(line.raw)}</p>
          {flagged && (
            <Pill size="sm" variant="soft" className="mt-1.5">
              {m.check}
            </Pill>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={m.change(line.name)}
          onClick={() => setExpanded((x) => !x)}
        >
          {expanded ? m.doneChange : m.changeShort}
        </Button>
      </div>

      {expanded && (
        <div id={panelId} className="mt-3 rounded-lg bg-surface-2 p-3">
          <label className="relative block">
            <span className="sr-only">{m.searchLabel}</span>
            <Search size={18} strokeWidth={1.75} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={m.searchPlaceholder}
              enterKeyHint="search"
              autoComplete="off"
              className="h-11 w-full rounded-md bg-raised pl-10 pr-3 text-base text-ink placeholder:text-ink-3"
            />
          </label>
          {!query.trim() && options.length > 0 && <p className="mt-3 text-xs font-medium text-ink-2">{m.alternatives}</p>}
          {options.length > 0 ? (
            <ul className="mt-1">
              {options.map((c) => {
                const current = choice.kind === 'match' && choice.pick.ref === c.ref
                return (
                  <li key={String(c.ref)}>
                    <button
                      type="button"
                      aria-pressed={current}
                      onClick={() => pick(c)}
                      className="flex min-h-11 w-full items-center rounded-md px-2 text-left text-base hover:bg-line aria-pressed:font-semibold"
                    >
                      {c.name}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            query.trim() && <p className="mt-3 text-sm text-ink-2">{m.noResults}</p>
          )}
          <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
            <Button
              size="sm"
              variant="ghost"
              className="justify-start"
              aria-pressed={choice.kind === 'skip'}
              onClick={() => {
                onChoice({ kind: 'skip' })
                setExpanded(false)
              }}
            >
              {m.skip}
            </Button>
            {choice.kind === 'custom' ? (
              <div>
                <span aria-hidden className="mb-1.5 block text-sm font-medium text-ink-2">
                  {m.customGroup}
                </span>
                <Select
                  label={m.customGroup}
                  variant="field"
                  placeholder={m.noGroup}
                  value={choice.group}
                  active={choice.group !== ''}
                  groups={[{ options: [{ value: '', label: m.noGroup }] }, { options: groupOptions.map((g) => ({ value: g.id, label: g.name })) }]}
                  onChange={(group) => onChoice({ kind: 'custom', group })}
                />
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="justify-start" onClick={() => onChoice({ kind: 'custom', group: '' })}>
                {m.asCustom}
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

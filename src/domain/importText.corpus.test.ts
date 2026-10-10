import { describe, expect, it } from 'vitest'
import { CORPUS } from './importCorpus.ts'
import { assignDays, parseProgramText, type ParsedLine } from './importText.ts'

const show = (l: ParsedLine) =>
  [
    l.name,
    l.sets !== undefined || l.reps !== undefined ? `${l.sets ?? '-'}x${l.reps ?? '-'}` : null,
    l.restSec !== undefined ? `rest ${l.restSec}` : null,
    l.rir !== undefined ? `rir ${l.rir}` : null,
    l.withPrev ? 'ss' : null,
  ]
    .filter(Boolean)
    .join(' | ')

describe('paste corpus', () => {
  it.each(CORPUS.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const parsed = parseProgramText(c.text)
    const { days } = assignDays(parsed.days)
    expect(
      days.map((d) => ({ day: d.day, ...(d.label ? { label: d.label } : {}), ...(d.rest ? { rest: true } : {}), ...(d.lines.length ? { lines: d.lines.map(show) } : {}) })),
    ).toEqual(c.days)
    expect(parsed.warnings.filter((w) => w.kind === 'unreadable')).toHaveLength(c.unreadable ?? 0)
  })
})

import { describe, expect, it } from 'vitest'
import { blankProgram } from '../../domain/program'
import { buildIcs, escapeText, foldLine, nextOccurrence, planEvents, type IcsEvent } from './ics'

// Friday 2 October 2026, local time.
const NOW = new Date(2026, 9, 2, 9, 30)
const bytes = (s: string) => new TextEncoder().encode(s).length
const unfold = (ics: string) => ics.replace(/\r\n /g, '')

const event = (day: IcsEvent['day'], minutes = 55, summary = 'Push · Gym plan', description = 'Bench press 3 × 6-8'): IcsEvent => ({
  day,
  summary,
  description,
  minutes,
})

describe('ics', () => {
  it('escapes TEXT values', () => {
    expect(escapeText('a\\b; c, d\ne')).toBe('a\\\\b\\; c\\, d\\ne')
  })

  it('folds at 75 octets without splitting Cyrillic letters', () => {
    const line = `DESCRIPTION:${'Жим лежачи 3 × 8, відпочинок 2 хв. '.repeat(6)}`
    const folded = foldLine(line)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    expect(bytes(parts[0])).toBeLessThanOrEqual(75)
    for (const p of parts.slice(1)) {
      expect(p.startsWith(' ')).toBe(true)
      expect(bytes(p)).toBeLessThanOrEqual(75)
    }
    expect(parts.join('').includes('�')).toBe(false)
    expect(unfold(folded)).toBe(line)
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short')
  })

  it('maps program days (0 = Monday) to the next matching date, today included', () => {
    expect(nextOccurrence(4, '18:00', NOW)).toEqual(new Date(2026, 9, 2, 18, 0))
    expect(nextOccurrence(0, '07:15', NOW)).toEqual(new Date(2026, 9, 5, 7, 15))
    expect(nextOccurrence(3, '18:00', NOW)).toEqual(new Date(2026, 9, 8, 18, 0))
    expect(nextOccurrence(6, '18:00', NOW)).toEqual(new Date(2026, 9, 4, 18, 0))
  })

  it('writes one weekly floating event per day with a duration from the estimate', () => {
    const ics = buildIcs({ programId: 'p1', events: [event(0, 55), event(2, 0, 'Pull · Gym plan')], time: '18:00', now: NOW })
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true)
    const text = unfold(ics)
    expect(text).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:[^\r]+\r\nCALSCALE:GREGORIAN\r\n/)
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(text.match(/RRULE:FREQ=WEEKLY/g)).toHaveLength(2)
    expect(text).toContain('UID:p1-mon@gym-builder')
    expect(text).toContain('UID:p1-wed@gym-builder')
    expect(text).toContain('DTSTART:20261005T180000\r\nDTEND:20261005T185500')
    // An empty estimate still gets 15 minutes.
    expect(text).toContain('DTSTART:20261007T180000\r\nDTEND:20261007T181500')
    expect(text).not.toMatch(/DTSTART[^\r]*Z|TZID/)
    expect(text).toMatch(/DTSTAMP:\d{8}T\d{6}Z/)
    expect(text).toContain('SUMMARY:Push · Gym plan')
    expect(text).toContain('DESCRIPTION:Bench press 3 × 6-8')
  })

  it('crosses midnight and hours for long sessions', () => {
    const text = unfold(buildIcs({ programId: 'p', events: [event(4, 95)], time: '23:00', now: NOW }))
    expect(text).toContain('DTSTART:20261002T230000\r\nDTEND:20261003T003500')
  })

  it('builds events for training days with exercises, with supersets, rest and RIR', () => {
    const program = blankProgram('p', 'Test', [0, 2, 4])
    program.custom.push(
      { id: 'c1', name: 'Bench, flat', equipment: [], laterality: 'bilateral', groups: { chest: 'primary' } },
      { id: 'c2', name: 'Row', equipment: [], laterality: 'bilateral', groups: { lats: 'primary' } },
    )
    program.days[0].label = 'Push'
    program.days[0].note = 'Warm up first'
    program.days[0].entries.push(
      { id: 'e1', exerciseId: 'c1', sets: 3, reps: '6-8', restSec: 120 },
      { id: 'e2', exerciseId: 'c2', sets: 3, reps: '10', rir: 2, withPrev: true },
    )
    program.days[4].entries.push({ id: 'e3', exerciseId: 'c2', sets: 4 })
    const days = program.days.map((d, i) => ({ kind: d.kind, label: d.label, estMinutes: i === 0 ? 40 : 20 }))
    const events = planEvents(program, days, new Map(), 'en')
    expect(events.map((e) => e.day)).toEqual([0, 4])
    expect(events[0].summary).toBe('Push · Gym plan')
    expect(events[0].description).toBe('A1 Bench, flat 3 × 6-8, rest 2 min\nA2 Row 3 × 10, RIR 2\nNote: Warm up first')
    expect(events[1].summary).toBe('Friday · Gym plan')
    expect(escapeText(events[0].description)).toContain('A1 Bench\\, flat 3 × 6-8\\, rest 2 min\\nA2')

    const uk = planEvents(program, days, new Map(), 'uk', 6)
    expect(uk.map((e) => e.day)).toEqual([0, 4])
    expect(uk[1].summary).toBe('Пʼятниця · План тренувань')
  })
})

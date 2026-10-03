import { describe, expect, it } from 'vitest'
import { ellipsize, IMAGE_WIDTH, layoutDay, layoutWeek, wrapText, type DayImageContent, type DrawOp, type Measure, type WeekImageContent } from './image'

// Every character is half the font size wide.
const measure: Measure = (text, font) => [...text].length * font.size * 0.5
const tenPx = (s: string) => [...s].length * 10

const texts = (ops: DrawOp[]) => ops.flatMap((o) => (o.t === 'text' ? [o.text] : []))

const day = (rows: DayImageContent['rows'], extra: Partial<DayImageContent> = {}): DayImageContent => ({
  title: 'Monday · Push',
  summary: '5 exercises · 17 sets · about 55 min',
  rows,
  footer: 'General information for planning training. Not medical advice.',
  app: 'Tenset',
  ...extra,
})

describe('text layout', () => {
  it('wraps on words and keeps short text on one line', () => {
    expect(wrapText('Bench press', 200, tenPx)).toEqual(['Bench press'])
    expect(wrapText('Incline dumbbell bench press', 120, tenPx)).toEqual(['Incline', 'dumbbell', 'bench press'])
  })

  it('breaks words wider than a line and handles Cyrillic', () => {
    expect(wrapText('Супервеликаназва', 60, tenPx)).toEqual(['Суперв', 'еликан', 'азва'])
    expect(wrapText('Жим гантелей лежачи', 120, tenPx)).toEqual(['Жим гантелей', 'лежачи'])
  })

  it('ends with an ellipsis past the line limit', () => {
    const lines = wrapText('one two three four five six', 90, tenPx, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
    expect(tenPx(lines[1])).toBeLessThanOrEqual(90)
    expect(ellipsize('Romanian deadlift', 100, tenPx)).toBe('Romanian…')
    expect(ellipsize('Squat', 100, tenPx)).toBe('Squat')
  })
})

describe('day image', () => {
  it('lists exercises with markers and details, and grows with content', () => {
    const one = layoutDay(day([{ name: 'Bench press', parts: ['3 × 6-8', 'rest 2 min'] }]), measure)
    const two = layoutDay(
      day([
        { marker: 'A1', name: 'Bench press', parts: ['3 × 6-8', 'rest 2 min'] },
        { marker: 'A2', name: 'Chest-supported row', parts: ['3 × 10', 'RIR 2'] },
      ]),
      measure,
    )
    expect(one.width).toBe(IMAGE_WIDTH)
    expect(two.height).toBeGreaterThan(one.height)
    expect(texts(two.ops)).toEqual(expect.arrayContaining(['A1', 'A2', 'Bench press', '3 × 6-8 · rest 2 min', '3 × 10 · RIR 2']))
    expect(two.ops.filter((o) => o.t === 'map').map((o) => o.t === 'map' && o.view)).toEqual(['front', 'back'])
    expect(two.scale).toBe('day')
  })

  it('caps long names at two lines and keeps every op inside the image', () => {
    const long = 'Very long exercise name '.repeat(12).trim()
    const layout = layoutDay(day([{ name: long, parts: ['3 × 8'] }], { note: 'Note: '.concat('keep it smooth '.repeat(20)) }), measure)
    const nameLines = layout.ops.filter((o) => o.t === 'text' && o.font.size === 36)
    expect(nameLines).toHaveLength(2)
    for (const o of layout.ops) {
      if (o.t !== 'text') continue
      expect(o.y).toBeLessThan(layout.height)
      expect(o.x + measure(o.text, o.font)).toBeLessThanOrEqual(IMAGE_WIDTH)
    }
  })

  it('shows the empty line for a rest day', () => {
    const layout = layoutDay(day([], { summary: 'Rest day', empty: 'Rest day' }), measure)
    expect(texts(layout.ops).filter((t) => t === 'Rest day')).toHaveLength(2)
  })
})

describe('week image', () => {
  const week = (rest: boolean): WeekImageContent => ({
    title: 'Upper/Lower 4x',
    subtitle: 'Week plan · 4 training days · 64 working sets · 2 October 2026',
    rows: Array.from({ length: 7 }, (_, i) => ({
      day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
      title: rest ? undefined : 'Upper',
      summary: rest ? 'Rest day' : '5 exercises · 17 sets · about 55 min',
      groups: rest ? undefined : 'Chest, Lats, Triceps',
      rest,
    })),
    legend: (['none', 'light', 'moderate', 'target', 'high', 'very_high'] as const).map((band) => ({ band, label: band })),
    mapCaption: 'Sets per muscle group, front and back',
    footer: 'General information for planning training. Not medical advice.',
    app: 'Tenset',
  })

  it('draws seven rows, a legend and the map; rest rows are compact', () => {
    const train = layoutWeek(week(false), measure)
    const rest = layoutWeek(week(true), measure)
    expect(train.ops.filter((o) => o.t === 'swatch')).toHaveLength(6)
    expect(texts(train.ops).filter((t) => t === 'Upper')).toHaveLength(7)
    expect(rest.height).toBeLessThan(train.height)
    expect(train.scale).toBe('week')
  })
})
